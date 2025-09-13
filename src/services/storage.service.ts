import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

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

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as NodeJS.ReadableStream) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (error) {
      console.error('Error downloading file:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to download file: ${errorMessage}`);
    }
  }
}
