import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

const MEDIA_SUMMARY_SELECT = {
  id: true,
  url: true,
  thumbUrl: true,
  originalFilename: true,
  kind: true,
  durationMs: true,
  mimeType: true,
  deletedAt: true,
} as const;

@Injectable()
export class TripProjectsService {
  private readonly logger = new Logger(TripProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async listProjects(tripId: string) {
    const projects = await this.prisma.tripProject.findMany({
      where: { tripId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { clips: true } } },
    });
    return projects.map(({ _count, ...project }) => ({
      ...project,
      clipCount: _count.clips,
    }));
  }

  async createProject(tripId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Нужно имя проекта');
    if (trimmed.length > 120) {
      throw new BadRequestException('Имя проекта слишком длинное');
    }
    return this.prisma.tripProject.create({
      data: { tripId, name: trimmed },
    });
  }

  async renameProject(tripId: string, projectId: number, name: string) {
    await this.requireProject(tripId, projectId);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Нужно имя проекта');
    if (trimmed.length > 120) {
      throw new BadRequestException('Имя проекта слишком длинное');
    }
    return this.prisma.tripProject.update({
      where: { id: projectId },
      data: { name: trimmed },
    });
  }

  async deleteProject(tripId: string, projectId: number) {
    const project = await this.prisma.tripProject.findFirst({
      where: { id: projectId, tripId },
      include: { clips: { select: { trimmedVideoUrl: true } } },
    });
    if (!project) throw new NotFoundException('Проект не найден');

    for (const clip of project.clips) {
      await this.storageService.deleteByPublicUrl(clip.trimmedVideoUrl);
    }
    await this.prisma.tripProject.delete({ where: { id: projectId } });
    return { deleted: true };
  }

  async getProject(tripId: string, projectId: number) {
    const project = await this.prisma.tripProject.findFirst({
      where: { id: projectId, tripId },
      include: {
        clips: {
          orderBy: { position: 'asc' },
          include: { media: { select: MEDIA_SUMMARY_SELECT } },
        },
      },
    });
    if (!project) throw new NotFoundException('Проект не найден');
    return project;
  }

  async addClip(tripId: string, projectId: number, mediaId: string) {
    await this.requireProject(tripId, projectId);
    const media = await this.prisma.tripMedia.findFirst({
      where: { id: mediaId, tripId, deletedAt: null },
    });
    if (!media) throw new NotFoundException('Видео не найдено');
    if (media.kind !== 'video') {
      throw new BadRequestException('В проект можно добавить только видео');
    }

    const max = await this.prisma.tripProjectClip.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    const position = (max._max.position ?? -1) + 1;

    const clip = await this.prisma.tripProjectClip.create({
      data: { projectId, mediaId, position },
      include: { media: { select: MEDIA_SUMMARY_SELECT } },
    });
    await this.touchProject(projectId);
    return clip;
  }

  async removeClip(tripId: string, projectId: number, clipId: number) {
    const clip = await this.requireClip(tripId, projectId, clipId);
    await this.storageService.deleteByPublicUrl(clip.trimmedVideoUrl);
    await this.prisma.tripProjectClip.delete({ where: { id: clipId } });
    await this.reindexPositions(projectId);
    await this.touchProject(projectId);
    return { deleted: true };
  }

  async reorderClips(tripId: string, projectId: number, clipIds: number[]) {
    await this.requireProject(tripId, projectId);
    if (!Array.isArray(clipIds) || clipIds.length === 0) {
      throw new BadRequestException('Нужен массив clipIds');
    }
    if (clipIds.some((id) => !Number.isInteger(id))) {
      throw new BadRequestException('clipIds должны быть целыми числами');
    }

    const existing = await this.prisma.tripProjectClip.findMany({
      where: { projectId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    if (
      clipIds.length !== existingIds.size ||
      clipIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        'clipIds должны содержать все клипы проекта ровно один раз',
      );
    }

    await this.prisma.$transaction(
      clipIds.map((id, position) =>
        this.prisma.tripProjectClip.update({
          where: { id },
          data: { position },
        }),
      ),
    );
    await this.touchProject(projectId);
    return this.getProject(tripId, projectId);
  }

  async updateClipTrim(
    tripId: string,
    projectId: number,
    clipId: number,
    trimStartSec: number | null | undefined,
    trimEndSec: number | null | undefined,
  ) {
    const clip = await this.requireClip(tripId, projectId, clipId);
    const media = await this.prisma.tripMedia.findUnique({
      where: { id: clip.mediaId },
    });
    if (!media) throw new NotFoundException('Видео не найдено');

    const durationSec =
      media.durationMs != null ? media.durationMs / 1000 : undefined;
    const nextStart =
      trimStartSec === undefined ? clip.trimStartSec : trimStartSec;
    const nextEnd = trimEndSec === undefined ? clip.trimEndSec : trimEndSec;
    this.assertTrimRange(nextStart, nextEnd, durationSec);

    if (clip.trimmedVideoUrl) {
      await this.storageService.deleteByPublicUrl(clip.trimmedVideoUrl);
    }

    const updated = await this.prisma.tripProjectClip.update({
      where: { id: clipId },
      data: {
        trimStartSec: nextStart,
        trimEndSec: nextEnd,
        trimmedVideoUrl: null,
      },
      include: { media: { select: MEDIA_SUMMARY_SELECT } },
    });
    await this.touchProject(projectId);
    return updated;
  }

  async applyTrim(tripId: string, projectId: number, clipId: number) {
    const clip = await this.requireClip(tripId, projectId, clipId);
    const media = await this.prisma.tripMedia.findUnique({
      where: { id: clip.mediaId },
    });
    if (!media?.url) {
      throw new BadRequestException('У клипа нет видео');
    }
    if (clip.trimStartSec == null && clip.trimEndSec == null) {
      throw new BadRequestException('Сначала задайте границы обрезки');
    }
    const durationSec =
      media.durationMs != null ? media.durationMs / 1000 : undefined;
    this.assertTrimRange(clip.trimStartSec, clip.trimEndSec, durationSec);

    const trimmedUrl = await this.trimAndUpload(
      tripId,
      projectId,
      clipId,
      media.url,
      clip.trimStartSec,
      clip.trimEndSec,
    );

    if (clip.trimmedVideoUrl && clip.trimmedVideoUrl !== trimmedUrl) {
      await this.storageService.deleteByPublicUrl(clip.trimmedVideoUrl);
    }

    const updated = await this.prisma.tripProjectClip.update({
      where: { id: clipId },
      data: { trimmedVideoUrl: trimmedUrl },
      include: { media: { select: MEDIA_SUMMARY_SELECT } },
    });
    await this.touchProject(projectId);
    return updated;
  }

  async exportZip(tripId: string, projectId: number): Promise<StreamableFile> {
    const project = await this.getProject(tripId, projectId);
    if (!project.clips.length) {
      throw new BadRequestException('В проекте нет клипов');
    }

    for (const clip of project.clips) {
      const needsTrim =
        (clip.trimStartSec != null || clip.trimEndSec != null) &&
        !clip.trimmedVideoUrl;
      if (needsTrim) {
        if (!clip.media.url) {
          throw new BadRequestException(
            `У клипа #${clip.id} нет исходного видео`,
          );
        }
        const trimmedUrl = await this.trimAndUpload(
          tripId,
          projectId,
          clip.id,
          clip.media.url,
          clip.trimStartSec,
          clip.trimEndSec,
        );
        await this.prisma.tripProjectClip.update({
          where: { id: clip.id },
          data: { trimmedVideoUrl: trimmedUrl },
        });
        clip.trimmedVideoUrl = trimmedUrl;
      }
    }

    const archive = new ZipArchive({ store: true });
    const pass = new PassThrough();
    archive.on('error', (error) => {
      this.logger.error(`ZIP export failed: ${String(error)}`);
      pass.destroy(error);
    });
    archive.pipe(pass);

    const pad = String(project.clips.length).length;
    for (let i = 0; i < project.clips.length; i++) {
      const clip = project.clips[i];
      const sourceUrl = clip.trimmedVideoUrl || clip.media.url;
      if (!sourceUrl) {
        throw new BadRequestException(
          `У клипа #${clip.id} нет видео для экспорта`,
        );
      }
      const buffer = await this.storageService.downloadFile(sourceUrl);
      const index = String(i + 1).padStart(Math.max(2, pad), '0');
      const base = (clip.media.originalFilename || `clip-${clip.id}`)
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .slice(0, 60);
      archive.append(buffer, { name: `${index}-${base || clip.id}.mp4` });
    }

    const asciiName =
      project.name
        .normalize('NFKD')
        .replace(/[^\x20-\x7E]+/g, '')
        .replace(/[^A-Za-z0-9._ -]+/g, '_')
        .trim()
        .slice(0, 80) || `project-${project.id}`;

    void archive.finalize();

    return new StreamableFile(pass as Readable, {
      type: 'application/zip',
      disposition: `attachment; filename="${asciiName}.zip"`,
    });
  }

  private async trimAndUpload(
    tripId: string,
    projectId: number,
    clipId: number,
    sourceUrl: string,
    trimStartSec: number | null,
    trimEndSec: number | null,
  ): Promise<string> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'trip-trim-'));
    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.mp4');
    try {
      const source = await this.storageService.downloadFile(sourceUrl);
      await writeFile(inputPath, source);

      const start = trimStartSec != null && trimStartSec > 0 ? trimStartSec : 0;
      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      if (start > 0) args.push('-ss', String(start));
      args.push('-i', inputPath);
      if (trimEndSec != null) {
        args.push('-t', String(Math.max(0.05, trimEndSec - start)));
      }
      args.push('-c', 'copy', '-movflags', '+faststart', outputPath);

      await this.runFfmpeg(args);
      const trimmed = await readFile(outputPath);
      if (!trimmed.length) {
        throw new Error('ffmpeg produced an empty file');
      }
      return this.storageService.uploadTripProjectClip(
        tripId,
        projectId,
        clipId,
        trimmed,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private assertTrimRange(
    start: number | null | undefined,
    end: number | null | undefined,
    duration?: number,
  ) {
    if (start != null) {
      if (!Number.isFinite(start) || start < 0) {
        throw new BadRequestException('trimStartSec должен быть ≥ 0');
      }
    }
    if (end != null) {
      if (!Number.isFinite(end) || end <= 0) {
        throw new BadRequestException('trimEndSec должен быть > 0');
      }
    }
    if (start != null && end != null && end <= start) {
      throw new BadRequestException(
        'trimEndSec должен быть больше trimStartSec',
      );
    }
    if (duration != null && Number.isFinite(duration)) {
      if (start != null && start >= duration) {
        throw new BadRequestException('trimStartSec за пределами ролика');
      }
      if (end != null && end > duration + 0.25) {
        throw new BadRequestException('trimEndSec за пределами ролика');
      }
    }
  }

  private async requireProject(tripId: string, projectId: number) {
    const project = await this.prisma.tripProject.findFirst({
      where: { id: projectId, tripId },
    });
    if (!project) throw new NotFoundException('Проект не найден');
    return project;
  }

  private async requireClip(tripId: string, projectId: number, clipId: number) {
    await this.requireProject(tripId, projectId);
    const clip = await this.prisma.tripProjectClip.findFirst({
      where: { id: clipId, projectId },
    });
    if (!clip) throw new NotFoundException('Клип не найден');
    return clip;
  }

  private async reindexPositions(projectId: number) {
    const clips = await this.prisma.tripProjectClip.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(
      clips.map((clip, position) =>
        this.prisma.tripProjectClip.update({
          where: { id: clip.id },
          data: { position },
        }),
      ),
    );
  }

  private async touchProject(id: number) {
    await this.prisma.tripProject.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('ffmpeg is not installed on the server'));
        } else {
          reject(error);
        }
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const lastLine =
            stderr.trim().split('\n').filter(Boolean).pop() ||
            `ffmpeg exited with code ${code}`;
          reject(new Error(lastLine));
        }
      });
    });
  }
}
