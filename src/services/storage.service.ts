import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
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

    async uploadFile(buffer: Buffer, mimeType: string): Promise<string> {
        const key = `images/${uuidv4()}`;
        
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