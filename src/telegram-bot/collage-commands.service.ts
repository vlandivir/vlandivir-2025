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

            console.log(`🎨 Creating collage from ${images.length} images`);

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
                console.log(`📸 Found ${photos.length} photos in message`);
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

            // Get metadata of all images to determine optimal dimensions
            const imageMetadata = await Promise.all(
                imageBuffers.map(async (buffer, index) => {
                    const metadata = await sharp(buffer).metadata();
                    if (!metadata.width || !metadata.height) {
                        throw new Error(`Could not get metadata for image ${index}`);
                    }
                    return { ...metadata, index };
                })
            );

            // Find the largest image to use as the main image
            const largestImage = imageMetadata.reduce((max, current) => {
                const maxArea = max.width * max.height;
                const currentArea = current.width * current.height;
                return currentArea > maxArea ? current : max;
            });

            console.log(`📐 Largest image (index ${largestImage.index}): ${largestImage.width}x${largestImage.height}`);

            // Use the largest image as the main image, but ensure minimum size
            const minWidth = 800;
            const minHeight = 600;
            
            let mainImageWidth = Math.max(largestImage.width, minWidth);
            let mainImageHeight = Math.max(largestImage.height, minHeight);
            
            // If the largest image is smaller than minimum, scale it up proportionally
            if (largestImage.width < minWidth || largestImage.height < minHeight) {
                const scaleX = minWidth / largestImage.width;
                const scaleY = minHeight / largestImage.height;
                const scale = Math.max(scaleX, scaleY);
                mainImageWidth = Math.round(largestImage.width * scale);
                mainImageHeight = Math.round(largestImage.height * scale);
            }

            const spacing = 5; // Small gap between images

            console.log(`📐 Final main image dimensions: ${mainImageWidth}x${mainImageHeight}`);

            // Calculate dimensions for additional images
            const additionalImagesCount = imageBuffers.length - 1;
            const totalSpacing = (additionalImagesCount - 1) * spacing;
            const availableWidth = mainImageWidth - totalSpacing;
            const additionalImageWidth = Math.floor(availableWidth / additionalImagesCount);

            // Calculate heights for all additional images first
            let maxAdditionalHeight = 0;
            const additionalImageHeights: number[] = [];

            for (let i = 0; i < imageBuffers.length; i++) {
                if (i === largestImage.index) continue; // Skip the main image

                const metadata = imageMetadata[i];
                // Calculate height to preserve aspect ratio
                const aspectRatio = metadata.width / metadata.height;
                const additionalImageHeight = Math.floor(additionalImageWidth / aspectRatio);
                additionalImageHeights.push(additionalImageHeight);
                maxAdditionalHeight = Math.max(maxAdditionalHeight, additionalImageHeight);

                console.log(`📐 Additional image ${i}: ${additionalImageWidth}x${additionalImageHeight} (original: ${metadata.width}x${metadata.height})`);
            }

            // Calculate total dimensions
            const totalWidth = mainImageWidth;
            const totalHeight = mainImageHeight + spacing + maxAdditionalHeight;

            console.log(`📐 Collage dimensions: ${totalWidth}x${totalHeight}`);
            console.log(`📐 Main image: ${mainImageWidth}x${mainImageHeight}`);
            console.log(`📐 Additional images width: ${additionalImageWidth}`);
            console.log(`📐 Max additional height: ${maxAdditionalHeight}`);
            console.log(`📐 Total spacing: ${totalSpacing}px, Available width: ${availableWidth}px`);

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

            // Add main image (largest image) at the top
            const mainImageBuffer = await sharp(imageBuffers[largestImage.index])
                .resize(mainImageWidth, mainImageHeight, { fit: 'inside' })
                .jpeg({ quality: 80 })
                .toBuffer();

            composite.push({
                input: mainImageBuffer,
                left: 0,
                top: 0
            });

            // Add additional images in a row below
            let additionalIndex = 0;
            for (let i = 0; i < imageBuffers.length; i++) {
                if (i === largestImage.index) continue; // Skip the main image

                const processedImage = await sharp(imageBuffers[i])
                    .resize(additionalImageWidth, additionalImageHeights[additionalIndex], { fit: 'inside' })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                const left = additionalIndex * (additionalImageWidth + spacing);
                composite.push({
                    input: processedImage,
                    left: left,
                    top: mainImageHeight + spacing
                });

                additionalIndex++;
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