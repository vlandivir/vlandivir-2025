import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

export type SubsAudioManifest = {
  hash: string;
  audioUrl: string;
  mimeType: string;
  size: number;
  waveform: number[];
  createdAt: string;
};

export type SubsTranscriptCue = {
  start: number;
  end: number;
  text: string;
};

export type SubsTranscriptWord = {
  start: number;
  end: number;
  word: string;
};

export type SubsAudioTranscript = {
  hash: string;
  language: string;
  model: string;
  text: string;
  cues: SubsTranscriptCue[];
  words: SubsTranscriptWord[];
  createdAt: string;
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3: S3;
  private readonly bucket = 'vlandivir-2025';
  private readonly endpoint = 'https://fra1.digitaloceanspaces.com';

  constructor(private readonly configService: ConfigService) {
    this.s3 = new S3({
      endpoint: this.endpoint,
      region: 'fra1',
      credentials: {
        accessKeyId:
          this.configService.get<string>('DO_SPACES_ACCESS_KEY') || '',
        secretAccessKey:
          this.configService.get<string>('DO_SPACES_SECRET_KEY') || '',
      },
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  private async ensureBucketExists() {
    try {
      await this.s3.headBucket({ Bucket: this.bucket });
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') {
        await this.s3.createBucket({
          Bucket: this.bucket,
          ACL: 'public-read',
        });
        console.log(`Created bucket: ${this.bucket}`);
      } else {
        console.error('Error checking bucket:', error);
        throw error;
      }
    }
  }

  async uploadFile(
    buffer: Buffer,
    mimeType: string,
    chatId: number,
  ): Promise<string> {
    const key = `chats/${chatId}/images/${uuidv4()}`;

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });

    await upload.done();
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  async uploadVideo(
    buffer: Buffer,
    mimeType: string,
    chatId: number,
  ): Promise<string> {
    const key = `chats/${chatId}/videos/${uuidv4()}`;

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });

    await upload.done();
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  async uploadVideoStream(
    stream: Readable,
    mimeType: string,
    chatId: number,
  ): Promise<string> {
    const key = `chats/${chatId}/videos/${uuidv4()}`;

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });

    await upload.done();
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  async uploadSubsVideoStream(
    stream: Readable,
    mimeType: string,
    hash: string,
  ): Promise<string> {
    const key = this.getSubsVideoKey(hash);

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });

    await upload.done();
    return this.getPublicUrl(key);
  }

  async uploadSubsAudioStream(
    stream: Readable,
    mimeType: string,
    hash: string,
  ): Promise<string> {
    const key = this.getSubsAudioKey(hash);

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });

    await upload.done();
    return this.getPublicUrl(key);
  }

  async uploadSubsRenderedVideoStream(
    stream: Readable,
    mimeType: string,
    hash: string,
  ): Promise<string> {
    const key = this.getSubsRenderedVideoKey(hash);

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });

    await upload.done();
    return this.getPublicUrl(key);
  }

  async uploadSubsAudioManifest(
    hash: string,
    manifest: SubsAudioManifest,
  ): Promise<string> {
    const key = this.getSubsAudioManifestKey(hash);

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(manifest),
        ContentType: 'application/json',
        ACL: 'public-read',
      },
    });

    await upload.done();
    return this.getPublicUrl(key);
  }

  async getSubsAudioManifest(hash: string): Promise<SubsAudioManifest | null> {
    try {
      const response = await this.s3.getObject({
        Bucket: this.bucket,
        Key: this.getSubsAudioManifestKey(hash),
      });

      if (!response.Body) return null;

      const buffer = await this.readStreamToBuffer(
        response.Body as NodeJS.ReadableStream,
      );
      const manifest = JSON.parse(buffer.toString('utf8')) as unknown;

      if (!this.isSubsAudioManifest(manifest)) return null;
      return manifest;
    } catch (error) {
      if (this.isMissingObjectError(error)) return null;
      throw error;
    }
  }

  async uploadSubsAudioTranscript(
    hash: string,
    language: string,
    transcript: SubsAudioTranscript,
  ): Promise<string> {
    const key = this.getSubsAudioTranscriptKey(hash, language);

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(transcript),
        ContentType: 'application/json',
        ACL: 'public-read',
      },
    });

    await upload.done();
    return this.getPublicUrl(key);
  }

  async getSubsAudioTranscript(
    hash: string,
    language: string,
  ): Promise<SubsAudioTranscript | null> {
    try {
      const response = await this.s3.getObject({
        Bucket: this.bucket,
        Key: this.getSubsAudioTranscriptKey(hash, language),
      });

      if (!response.Body) return null;

      const buffer = await this.readStreamToBuffer(
        response.Body as NodeJS.ReadableStream,
      );
      const transcript = JSON.parse(buffer.toString('utf8')) as unknown;

      if (!this.isSubsAudioTranscript(transcript)) return null;
      return transcript;
    } catch (error) {
      if (this.isMissingObjectError(error)) return null;
      throw error;
    }
  }

  getSubsVideoUrl(hash: string): string {
    return this.getPublicUrl(this.getSubsVideoKey(hash));
  }

  getSubsAudioUrl(hash: string): string {
    return this.getPublicUrl(this.getSubsAudioKey(hash));
  }

  getSubsRenderedVideoUrl(hash: string): string {
    return this.getPublicUrl(this.getSubsRenderedVideoKey(hash));
  }

  async uploadFileWithKey(
    buffer: Buffer,
    mimeType: string,
    key: string,
  ): Promise<string> {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read',
      },
    });
    await upload.done();
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  private getSubsVideoKey(hash: string): string {
    return `subs/videos/${hash}/source`;
  }

  private getSubsAudioKey(hash: string): string {
    return `subs/videos/${hash}/audio/audio.mp3`;
  }

  private getSubsAudioManifestKey(hash: string): string {
    return `subs/videos/${hash}/audio/waveform.json`;
  }

  private getSubsAudioTranscriptKey(hash: string, language: string): string {
    return `subs/videos/${hash}/audio/transcript-words-${this.normalizeStorageSegment(language)}.json`;
  }

  private getSubsRenderedVideoKey(hash: string): string {
    return `subs/videos/${hash}/renders/subtitled.mp4`;
  }

  private getPublicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  private isSubsAudioManifest(value: unknown): value is SubsAudioManifest {
    if (!value || typeof value !== 'object') return false;

    const manifest = value as Partial<SubsAudioManifest>;
    return (
      typeof manifest.hash === 'string' &&
      typeof manifest.audioUrl === 'string' &&
      typeof manifest.mimeType === 'string' &&
      typeof manifest.size === 'number' &&
      typeof manifest.createdAt === 'string' &&
      Array.isArray(manifest.waveform) &&
      manifest.waveform.every((peak) => typeof peak === 'number')
    );
  }

  private isSubsAudioTranscript(value: unknown): value is SubsAudioTranscript {
    if (!value || typeof value !== 'object') return false;

    const transcript = value as Partial<SubsAudioTranscript>;
    return (
      typeof transcript.hash === 'string' &&
      typeof transcript.language === 'string' &&
      typeof transcript.model === 'string' &&
      typeof transcript.text === 'string' &&
      typeof transcript.createdAt === 'string' &&
      Array.isArray(transcript.cues) &&
      Array.isArray(transcript.words) &&
      transcript.cues.every(
        (cue) =>
          typeof cue?.start === 'number' &&
          typeof cue?.end === 'number' &&
          typeof cue?.text === 'string',
      ) &&
      transcript.words.every(
        (word) =>
          typeof word?.start === 'number' &&
          typeof word?.end === 'number' &&
          typeof word?.word === 'string',
      )
    );
  }

  private isMissingObjectError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.name === 'NoSuchKey' ||
      error.name === 'NotFound' ||
      error.message.includes('NoSuchKey') ||
      error.message.includes('not found')
    );
  }

  private normalizeStorageSegment(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  }

  private async readStreamToBuffer(
    stream: NodeJS.ReadableStream,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async downloadFile(url: string): Promise<Buffer> {
    try {
      // Extract key from URL
      const urlParts = url.split('/');
      const key = urlParts.slice(urlParts.indexOf(this.bucket) + 1).join('/');

      const response = await this.s3.getObject({
        Bucket: this.bucket,
        Key: key,
      });

      if (!response.Body) {
        throw new Error('No body in response');
      }

      return this.readStreamToBuffer(response.Body as NodeJS.ReadableStream);
    } catch (error) {
      console.error('Error downloading file:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to download file: ${errorMessage}`);
    }
  }
}
