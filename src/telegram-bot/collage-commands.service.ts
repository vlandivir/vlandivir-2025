import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';
import * as sharp from 'sharp';

@Injectable()
export class CollageCommandsService {
    constructor(
        private prisma: PrismaService,
        private storageService: StorageService
    ) {}

    async handleCollageCommand(ctx: Context) {
        const chatId = ctx.chat?.id;
        if (!chatId) return;

        try {
            // Get images from the current message
            const images = await this.getImagesFromMessage(ctx);
            
            if (images.length < 2) {
                await ctx.reply('Для создания коллажа нужно минимум 2 изображения в одном сообщении.');
                return;
            }

            // Create collage
            const collageBuffer = await this.createCollage(images);
            
            // Upload collage to storage
            const collageUrl = await this.storageService.uploadFile(
                collageBuffer,
                'image/jpeg',
                chatId
            );

            // Send collage
            await ctx.replyWithPhoto(collageUrl, {
                caption: 'Коллаж из изображений'
            });

        } catch (error) {
            console.error('Error creating collage:', error);
            await ctx.reply('Произошла ошибка при создании коллажа');
        }
    }

    private async getImagesFromMessage(ctx: Context): Promise<Buffer[]> {
        const images: Buffer[] = [];
        
        // Check if this is a message with multiple photos
        if ('message' in ctx && ctx.message && 'photo' in ctx.message) {
            const photos = ctx.message.photo;
            if (photos && photos.length > 0) {
                // Download all photos from the message
                for (const photo of photos) {
                    const file = await ctx.telegram.getFile(photo.file_id);
                    const photoBuffer = await this.downloadPhoto(file.file_path!);
                    images.push(photoBuffer);
                }
            }
        }

        return images;
    }

    private async downloadPhoto(filePath: string): Promise<Buffer> {
        const response = await fetch(
            `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`
        );
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    private async createCollage(imageBuffers: Buffer[]): Promise<Buffer> {
        try {
            if (imageBuffers.length < 2) {
                throw new Error('Need at least 2 images for collage');
            }

            // Get metadata of the first image to determine dimensions
            const firstImageMetadata = await sharp(imageBuffers[0]).metadata();
            if (!firstImageMetadata.width || !firstImageMetadata.height) {
                throw new Error('Could not get first image dimensions');
            }

            const mainImageWidth = firstImageMetadata.width;
            const mainImageHeight = firstImageMetadata.height;
            const spacing = 10; // White line spacing

            // Calculate dimensions for additional images
            const additionalImagesCount = imageBuffers.length - 1;
            const additionalImageWidth = Math.floor((mainImageWidth - (additionalImagesCount - 1) * spacing) / additionalImagesCount);
            const additionalImageHeight = 200; // Fixed height for additional images

            // Calculate total dimensions
            const totalWidth = mainImageWidth;
            const totalHeight = mainImageHeight + spacing + additionalImageHeight;

            // Create canvas
            const canvas = sharp({
                create: {
                    width: totalWidth,
                    height: totalHeight,
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 } // White background
                }
            });

            // Create composite array
            const composite: sharp.OverlayOptions[] = [];

            // Add main image (first image) at the top - keep original size
            composite.push({
                input: imageBuffers[0],
                left: 0,
                top: 0
            });

            // Add additional images in a row below
            for (let i = 1; i < imageBuffers.length; i++) {
                const processedImage = await sharp(imageBuffers[i])
                    .resize(additionalImageWidth, additionalImageHeight, { fit: 'cover' })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                const left = (i - 1) * (additionalImageWidth + spacing);
                composite.push({
                    input: processedImage,
                    left: left,
                    top: mainImageHeight + spacing
                });
            }

            // Create final collage
            const collageBuffer = await canvas
                .composite(composite)
                .jpeg({ quality: 90 })
                .toBuffer();

            return collageBuffer;

        } catch (error) {
            console.error('Error in createCollage:', error);
            throw error;
        }
    }
} 