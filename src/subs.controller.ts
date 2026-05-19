import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { stat, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Request } from 'express';
import {
  StorageService,
  type SubsAudioManifest,
  type SubsAudioTranscript,
  type SubsTranscriptCue,
  type SubsTranscriptWord,
} from './services/storage.service';

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

@Controller('subs-api')
export class SubsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  @Post('videos')
  @UseInterceptors(
    FileInterceptor('video', {
      dest: tmpdir(),
      limits: {
        fileSize: 1024 * 1024 * 1024,
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
      const videoUrl = await this.storageService.uploadSubsVideoStream(
        createReadStream(file.path),
        file.mimetype,
        hash,
      );

      return {
        hash,
        pageUrl: `/subs/${hash}`,
        absolutePageUrl: this.getAbsolutePageUrl(req, hash),
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

  private normalizeTranscriptionLanguage(language?: string): string {
    const normalized = (language || 'auto').trim().toLowerCase();
    if (normalized === 'auto' || normalized === '') return 'auto';
    if (!/^[a-z]{2,3}$/.test(normalized)) {
      throw new BadRequestException('Invalid transcription language');
    }

    return normalized;
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
