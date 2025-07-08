import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

@Injectable()
export class HistoryCommandsService {
    constructor(
        private prisma: PrismaService,
        private configService: ConfigService
    ) {}

    async handleHistoryCommand(ctx: Context) {
        const chatId = ctx.chat?.id;
        if (!chatId) return;

        try {
            // Get all messages from the current chat
            const messages = await this.prisma.note.findMany({
                where: {
                    chatId: chatId,
                },
                orderBy: {
                    noteDate: 'asc'
                },
                include: {
                    images: true
                }
            });

            // Filter messages that are longer than 42 characters
            const filteredMessages = messages.filter(message => 
                message.content.length > 42
            );

            if (filteredMessages.length === 0) {
                await ctx.reply('Нет сообщений длиннее 42 символов в этом чате.');
                return;
            }

            // Generate a unique GUID for the secret link
            const secretId = uuidv4();
            
            // Create HTML content
            const htmlContent = this.generateHtmlPage(filteredMessages, chatId);
            
            // Save the HTML content to a file or database
            // For now, we'll create a simple endpoint that serves this content
            // You might want to save this to a file system or database
            const baseUrl = this.configService.get<string>('VLANDIVIR_2025_BASE_URL') || 'http://localhost:3000';
            const secretLink = `${baseUrl}/history/${secretId}`;
            
            // Store the HTML content temporarily (you might want to use Redis or a database)
            // For now, we'll create a simple in-memory storage
            this.storeHtmlContent(secretId, htmlContent);

            await ctx.reply(`История чата доступна по ссылке: ${secretLink}`);
            
        } catch (error) {
            console.error('Error handling history command:', error);
            await ctx.reply('Произошла ошибка при создании истории чата');
        }
    }

    private generateHtmlPage(messages: any[], chatId: number): string {
        const chatTitle = `Чат ${chatId}`;
        const messageCount = messages.length;
        
        let html = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>История чата</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
            line-height: 1.6;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
        }
        .message {
            background: white;
            padding: 15px;
            margin: 10px 0;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
        }
        .message-date {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 8px;
        }
        .message-content {
            color: #333;
            white-space: pre-wrap;
        }
        .message-image {
            margin-top: 10px;
            text-align: center;
        }
        .message-image img {
            max-width: 100%;
            max-height: 400px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .stats {
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📚 История чата</h1>
        <p>Все сообщения длиннее 42 символов</p>
    </div>
    
    <div class="stats">
        <h3>📊 Статистика</h3>
        <p>Всего сообщений: ${messageCount}</p>
        <p>Период: ${messages.length > 0 ? format(new Date(messages[0].noteDate), 'dd.MM.yyyy', { locale: ru }) : 'N/A'} - ${messages.length > 0 ? format(new Date(messages[messages.length - 1].noteDate), 'dd.MM.yyyy', { locale: ru }) : 'N/A'}</p>
    </div>
`;

        messages.forEach((message, index) => {
            const date = format(new Date(message.noteDate), 'dd.MM.yyyy HH:mm', { locale: ru });
            html += `
    <div class="message">
        <div class="message-date">📅 ${date}</div>
        <div class="message-content">${this.escapeHtml(message.content)}</div>
`;
            
            if (message.images && message.images.length > 0) {
                message.images.forEach((image: any) => {
                    html += `
        <div class="message-image">
            <img src="${image.url}" alt="Изображение" />
        </div>
`;
                });
            }
            
            html += `    </div>`;
        });

        html += `
    <div class="footer">
        <p>Сгенерировано: ${format(new Date(), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}</p>
    </div>
</body>
</html>`;

        return html;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private htmlContentStorage: Map<string, string> = new Map();

    private storeHtmlContent(secretId: string, htmlContent: string): void {
        this.htmlContentStorage.set(secretId, htmlContent);
        
        // Clean up old content after 24 hours
        setTimeout(() => {
            this.htmlContentStorage.delete(secretId);
        }, 24 * 60 * 60 * 1000);
    }

    public getHtmlContent(secretId: string): string | null {
        return this.htmlContentStorage.get(secretId) || null;
    }
} 