import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService implements OnModuleInit {
    private s3: S3;
    private bucket = 'vlandivir-2025';
    private endpoint = 'https://fra1.digitaloceanspaces.com';

    constructor(private configService: ConfigService) {
        this.s3 = new S3({
            endpoint: this.endpoint,
            region: 'fra1',
            credentials: {
                accessKeyId: this.configService.get<string>('DO_SPACES_ACCESS_KEY') || '',
                secretAccessKey: this.configService.get<string>('DO_SPACES_SECRET_KEY') || '',
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
            if (error.name === 'NotFound') {
                await this.s3.createBucket({
                    Bucket: this.bucket,
                    ACL: 'public-read'
                });
                console.log(`Created bucket: ${this.bucket}`);
            } else {
                console.error('Error checking bucket:', error);
                throw error;
            }
        }
    }

    async uploadFile(buffer: Buffer, mimeType: string, chatId: number): Promise<string> {
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

    async uploadFileWithKey(buffer: Buffer, mimeType: string, key: string): Promise<string> {
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
} 