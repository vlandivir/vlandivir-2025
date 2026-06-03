import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Request, Response } from 'express';
import {
  StorageService,
  type SubsAudioManifest,
  type SubsAudioTranscript,
  type SubsTranscriptCue,
  type SubsTranscriptWord,
} from './services/storage.service';
import { TelegramBotService } from './telegram-bot/telegram-bot.service';

type UploadedVideo = {
  hash: string;
  pageUrl: string;
  absolutePageUrl: string;
  videoUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  audio?: SubsAudioManifest;
};

type ExtractedAudio = {
  hash: string;
  audioUrl: string;
  mimeType: string;
  size: number;
  waveform: number[];
  createdAt: string;
};

type TranscriptionRequest = {
  language?: string;
};

type RenderSubtitledVideoRequest = {
  ass?: string;
};

type RenderedSubtitledVideo = {
  hash: string;
  videoUrl: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

type OpenAiTranscriptionSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type OpenAiTranscriptionWord = {
  start?: number;
  end?: number;
  word?: string;
};

type OpenAiTranscriptionResponse = {
  text?: string;
  segments?: OpenAiTranscriptionSegment[];
  words?: OpenAiTranscriptionWord[];
};

type MulterDiskFile = {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
};

type VideoDimensions = {
  width: number;
  height: number;
};

const MAX_SUBS_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;
const REQUIRED_SUBS_VIDEO_WIDTH = 1080;
const REQUIRED_SUBS_VIDEO_HEIGHT = 1920;
const PRIMARY_CHAT_ID = 150847737;

@Controller('subs-api')
export class SubsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly telegramBotService: TelegramBotService,
  ) {}

  @Post('videos')
  @UseInterceptors(
    FileInterceptor('video', {
      dest: tmpdir(),
      limits: {
        fileSize: MAX_SUBS_VIDEO_SIZE_BYTES,
      },
      fileFilter: (_req, file, callback) => {
        if (file.mimetype.startsWith('video/')) {
          callback(null, true);
          return;
        }

        callback(
          new BadRequestException('Only video files are supported'),
          false,
        );
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: MulterDiskFile | undefined,
    @Req() req: Request,
  ): Promise<UploadedVideo> {
    if (!file) {
      throw new BadRequestException('Video file is required');
    }

    const hash = this.createHash();

    try {
      await this.assertUploadVideoMeetsRequirements(file);

      const videoUrl = await this.storageService.uploadSubsVideoStream(
        createReadStream(file.path),
        file.mimetype,
        hash,
      );
      const absolutePageUrl = this.getAbsolutePageUrl(req, hash);
      await this.notifySubsVideoUploaded({
        hash,
        videoUrl,
        absolutePageUrl,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });

      return {
        hash,
        pageUrl: `/subs/${hash}`,
        absolutePageUrl,
        videoUrl,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        createdAt: new Date().toISOString(),
      };
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Get('videos/:hash')
  async getVideo(@Param('hash') hash: string, @Req() req: Request) {
    this.assertHash(hash);
    const audio = await this.storageService.getSubsAudioManifest(hash);

    return {
      hash,
      pageUrl: `/subs/${hash}`,
      absolutePageUrl: this.getAbsolutePageUrl(req, hash),
      videoUrl: this.storageService.getSubsVideoUrl(hash),
      ...(audio ? { audio } : {}),
    };
  }

  @Post('videos/:hash/audio')
  async extractAudio(@Param('hash') hash: string): Promise<ExtractedAudio> {
    this.assertHash(hash);

    const cachedAudio = await this.storageService.getSubsAudioManifest(hash);
    if (cachedAudio) return cachedAudio;

    const audioPath = join(tmpdir(), `subs-${hash}-${this.createHash()}.mp3`);
    const videoUrl = this.storageService.getSubsVideoUrl(hash);

    try {
      await this.runFfmpeg([
        '-y',
        '-i',
        videoUrl,
        '-vn',
        '-map',
        '0:a:0',
        '-acodec',
        'libmp3lame',
        '-b:a',
        '192k',
        audioPath,
      ]);

      const [audioStat, waveform] = await Promise.all([
        stat(audioPath),
        this.buildWaveform(audioPath),
      ]);
      const audioUrl = await this.storageService.uploadSubsAudioStream(
        createReadStream(audioPath),
        'audio/mpeg',
        hash,
      );

      const manifest = {
        hash,
        audioUrl,
        mimeType: 'audio/mpeg',
        size: audioStat.size,
        waveform,
        createdAt: new Date().toISOString(),
      };

      await this.storageService.uploadSubsAudioManifest(hash, manifest);
      return manifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Stream map') ||
        message.includes('matches no streams')
      ) {
        throw new BadRequestException('Video does not contain an audio track');
      }
      throw new InternalServerErrorException(
        `Failed to extract audio: ${message}`,
      );
    } finally {
      await unlink(audioPath).catch(() => undefined);
    }
  }

  @Post('videos/:hash/audio/transcript')
  async transcribeAudio(
    @Param('hash') hash: string,
    @Body() body: TranscriptionRequest,
  ): Promise<SubsAudioTranscript> {
    this.assertHash(hash);

    const language = this.normalizeTranscriptionLanguage(body?.language);
    const cachedTranscript = await this.storageService.getSubsAudioTranscript(
      hash,
      language,
    );
    if (cachedTranscript) return cachedTranscript;

    const audio = await this.storageService.getSubsAudioManifest(hash);
    if (!audio) {
      throw new BadRequestException('Extract audio before transcription');
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('OPENAI_API_KEY is not defined');
    }

    const audioBuffer = await this.storageService.downloadFile(audio.audioUrl);
    const response = await this.requestOpenAiTranscription(
      apiKey,
      audioBuffer,
      hash,
      language,
    );
    const cues = this.normalizeTranscriptionSegments(response);
    const words = this.normalizeTranscriptionWords(response);
    const transcript = {
      hash,
      language,
      model: 'whisper-1',
      text: (response.text || words.map((word) => word.word).join(' ')).trim(),
      cues,
      words,
      createdAt: new Date().toISOString(),
    };

    await this.storageService.uploadSubsAudioTranscript(
      hash,
      language,
      transcript,
    );
    return transcript;
  }

  @Post('videos/:hash/render')
  async renderSubtitledVideo(
    @Param('hash') hash: string,
    @Body() body: RenderSubtitledVideoRequest,
  ): Promise<RenderedSubtitledVideo> {
    this.assertHash(hash);

    const ass = (body?.ass || '').trim();
    if (!ass) {
      throw new BadRequestException('ASS content is required');
    }

    const renderId = this.createHash();
    const assPath = join(tmpdir(), `subs-${hash}-${renderId}.ass`);
    const outputPath = join(tmpdir(), `subs-${hash}-${renderId}.mp4`);
    const fontsDir = join(process.cwd(), 'web', 'subs', 'fonts');
    const videoUrl = this.storageService.getSubsVideoUrl(hash);

    try {
      await writeFile(assPath, ass, 'utf8');
      await this.runFfmpeg([
        '-y',
        '-i',
        videoUrl,
        '-vf',
        `subtitles=${this.escapeFfmpegFilterPath(assPath)}:fontsdir=${this.escapeFfmpegFilterPath(fontsDir)}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
        outputPath,
      ]);

      const outputStat = await stat(outputPath);
      const renderedUrl =
        await this.storageService.uploadSubsRenderedVideoStream(
          createReadStream(outputPath),
          'video/mp4',
          hash,
        );

      return {
        hash,
        videoUrl: renderedUrl,
        mimeType: 'video/mp4',
        size: outputStat.size,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to render subtitled video: ${message}`,
      );
    } finally {
      await Promise.all([
        unlink(assPath).catch(() => undefined),
        unlink(outputPath).catch(() => undefined),
      ]);
    }
  }

  @Get('videos/:hash/render/download')
  @Header('Content-Type', 'video/mp4')
  @Header('Content-Disposition', 'attachment; filename="subtitled-video.mp4"')
  async downloadRenderedVideo(
    @Param('hash') hash: string,
    @Res() res: Response,
  ) {
    this.assertHash(hash);

    try {
      const buffer = await this.storageService.downloadFile(
        this.storageService.getSubsRenderedVideoUrl(hash),
      );
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to download rendered video: ${message}`,
      );
    }
  }

  @Get('videos/:hash/source/download')
  @Header('Content-Type', 'video/mp4')
  @Header('Content-Disposition', 'attachment; filename="subs-source-video"')
  async downloadSourceVideo(
    @Param('hash') hash: string,
    @Res() res: Response,
  ) {
    this.assertHash(hash);

    try {
      const buffer = await this.storageService.downloadFile(
        this.storageService.getSubsVideoUrl(hash),
      );
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to download source video: ${message}`,
      );
    }
  }

  private createHash(): string {
    return randomBytes(12).toString('hex');
  }

  private assertHash(hash: string): void {
    if (!/^[a-f0-9]{24}$/.test(hash)) {
      throw new BadRequestException('Invalid video hash');
    }
  }

  private getAbsolutePageUrl(req: Request, hash: string): string {
    const forwardedProto = req.header('x-forwarded-proto');
    const proto = forwardedProto?.split(',')[0]?.trim() || req.protocol;
    return `${proto}://${req.get('host')}/subs/${hash}`;
  }

  private async notifySubsVideoUploaded(video: {
    hash: string;
    videoUrl: string;
    absolutePageUrl: string;
    originalName: string;
    mimeType: string;
    size: number;
  }): Promise<void> {
    const message = [
      'В Subs загрузили видео',
      '',
      `Файл: ${video.originalName || video.hash}`,
      `Размер: ${this.formatBytes(video.size)}`,
      `Тип: ${video.mimeType || 'video'}`,
      `Страница: ${video.absolutePageUrl}`,
      `DO файл: ${video.videoUrl}`,
    ].join('\n');

    try {
      await this.telegramBotService.sendDirectMessage(PRIMARY_CHAT_ID, message);
    } catch (error) {
      console.warn('Failed to send Subs upload notification', error);
    }
  }

  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const unit = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    const value = bytes / 1024 ** unit;
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  private async assertUploadVideoMeetsRequirements(
    file: MulterDiskFile,
  ): Promise<void> {
    if (file.size > MAX_SUBS_VIDEO_SIZE_BYTES) {
      throw new BadRequestException('Video must be 200 MB or smaller');
    }

    const dimensions = await this.readVideoDimensions(file.path);
    if (
      dimensions.width !== REQUIRED_SUBS_VIDEO_WIDTH ||
      dimensions.height !== REQUIRED_SUBS_VIDEO_HEIGHT
    ) {
      throw new BadRequestException(
        'Video must be vertical 1080p: 1080×1920 px',
      );
    }
  }

  private async readVideoDimensions(path: string): Promise<VideoDimensions> {
    const output = await this.runFfprobeCapture([
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:stream_tags=rotate:stream_side_data=rotation',
      '-of',
      'json',
      path,
    ]);

    const parsed = JSON.parse(output.toString()) as {
      streams?: Array<{
        width?: number;
        height?: number;
        tags?: { rotate?: string };
        side_data_list?: Array<{ rotation?: number }>;
      }>;
    };
    const stream = parsed.streams?.[0];
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new BadRequestException('Could not read video dimensions');
    }

    const tagRotation = Number(stream?.tags?.rotate || 0);
    const sideDataRotation = Number(
      stream?.side_data_list?.find((item) =>
        Number.isFinite(Number(item.rotation)),
      )?.rotation || 0,
    );
    const rotation = Math.abs(tagRotation || sideDataRotation) % 180;
    if (rotation === 90) {
      return { width: height, height: width };
    }

    return { width, height };
  }

  private normalizeTranscriptionLanguage(language?: string): string {
    const normalized = (language || 'auto').trim().toLowerCase();
    if (normalized === 'auto' || normalized === '') return 'auto';
    if (!/^[a-z]{2,3}$/.test(normalized)) {
      throw new BadRequestException('Invalid transcription language');
    }

    return normalized;
  }

  private escapeFfmpegFilterPath(path: string): string {
    return path
      .replace(/\\/g, '\\\\')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
  }

  private async requestOpenAiTranscription(
    apiKey: string,
    audioBuffer: Buffer,
    hash: string,
    language: string,
  ): Promise<OpenAiTranscriptionResponse> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutSignal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(10 * 60 * 1000)
        : (() => {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);
            return controller.signal;
          })();

    try {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }),
        `${hash}.mp3`,
      );
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');
      formData.append('timestamp_granularities[]', 'word');
      formData.append('temperature', '0');
      if (language !== 'auto') {
        formData.append('language', language);
      }

      const response = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal: timeoutSignal,
        },
      );

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `OpenAI transcription error: ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`,
        );
      }

      const data = (await response.json()) as unknown;
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid transcription response');
      }

      return data as OpenAiTranscriptionResponse;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to transcribe audio: ${message}`,
      );
    }
  }

  private normalizeTranscriptionSegments(
    response: OpenAiTranscriptionResponse,
  ): SubsTranscriptCue[] {
    if (!Array.isArray(response.segments)) {
      const text = (response.text || '').trim();
      return text ? [{ start: 0, end: 0, text }] : [];
    }

    return response.segments
      .map((segment) => ({
        start: Number(segment.start || 0),
        end: Number(segment.end || 0),
        text: (segment.text || '').trim(),
      }))
      .filter((segment) => segment.text);
  }

  private normalizeTranscriptionWords(
    response: OpenAiTranscriptionResponse,
  ): SubsTranscriptWord[] {
    if (!Array.isArray(response.words)) return [];

    return response.words
      .map((word) => ({
        start: Number(word.start || 0),
        end: Number(word.end || 0),
        word: (word.word || '').trim(),
      }))
      .filter((word) => word.word);
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args);
      let stderr = '';

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });
      child.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new Error('ffmpeg is not installed on the server'));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });
  }

  private runFfmpegCapture(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args);
      const stdoutChunks: Buffer[] = [];
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });
      child.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new Error('ffmpeg is not installed on the server'));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdoutChunks));
          return;
        }
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });
  }

  private runFfprobeCapture(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffprobe', args);
      const stdoutChunks: Buffer[] = [];
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });
      child.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new Error('ffprobe is not installed on the server'));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdoutChunks));
          return;
        }
        reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
      });
    });
  }

  private async buildWaveform(audioPath: string): Promise<number[]> {
    const raw = await this.runFfmpegCapture([
      '-i',
      audioPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      's16le',
      'pipe:1',
    ]);
    const sampleCount = Math.floor(raw.length / 2);
    if (sampleCount === 0) return [];

    const bucketCount = 180;
    const samplesPerBucket = Math.max(1, Math.ceil(sampleCount / bucketCount));
    const waveform: number[] = [];

    for (
      let bucketStart = 0;
      bucketStart < sampleCount;
      bucketStart += samplesPerBucket
    ) {
      const bucketEnd = Math.min(sampleCount, bucketStart + samplesPerBucket);
      let peak = 0;
      for (
        let sampleIndex = bucketStart;
        sampleIndex < bucketEnd;
        sampleIndex += 1
      ) {
        const value = Math.abs(raw.readInt16LE(sampleIndex * 2)) / 32768;
        if (value > peak) peak = value;
      }
      waveform.push(Number(peak.toFixed(4)));
    }

    return waveform;
  }
}
