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
            // Get recent images for this chat
            const recentImages = await this.prisma.image.findMany({
                where: {
                    note: {
                        chatId: chatId
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 10, // Limit to 10 most recent images
                include: {
                    note: true
                }
            });

            if (recentImages.length < 2) {
                await ctx.reply('Для создания коллажа нужно минимум 2 изображения. Отправьте больше изображений.');
                return;
            }

            // Create collage
            const collageBuffer = await this.createCollage(recentImages);
            
            // Upload collage to storage
            const collageUrl = await this.storageService.uploadFile(
                collageBuffer,
                'image/jpeg',
                chatId
            );

            // Send collage
            await ctx.replyWithPhoto(collageUrl, {
                caption: 'Коллаж из последних изображений'
            });

        } catch (error) {
            console.error('Error creating collage:', error);
            await ctx.reply('Произошла ошибка при создании коллажа');
        }
    }

    private async createCollage(images: any[]): Promise<Buffer> {
        try {
            // Download all images
            const imageBuffers = await Promise.all(
                images.map(async (image) => {
                    const buffer = await this.storageService.downloadFile(image.url);
                    return buffer;
                })
            );

            // Process images
            const processedImages = await Promise.all(
                imageBuffers.map(async (buffer) => {
                    return await sharp(buffer)
                        .resize(300, 300, { fit: 'cover' })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                })
            );

            // Calculate dimensions
            const imageWidth = 300;
            const imageHeight = 300;
            const spacing = 10; // White line spacing
            const mainImageHeight = 400; // Main image is larger

            // Calculate total width and height
            const totalWidth = imageWidth + (processedImages.length - 1) * (imageWidth + spacing);
            const totalHeight = mainImageHeight + spacing + imageHeight;

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

            // Add main image (first image) at the top
            if (processedImages.length > 0) {
                const mainImage = await sharp(processedImages[0])
                    .resize(imageWidth, mainImageHeight, { fit: 'cover' })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                composite.push({
                    input: mainImage,
                    left: 0,
                    top: 0
                });
            }

            // Add additional images in a row below
            for (let i = 1; i < processedImages.length; i++) {
                const left = (i - 1) * (imageWidth + spacing);
                composite.push({
                    input: processedImages[i],
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