import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SerbianCommandsService {
    private readonly apiKey: string;

    constructor(private configService: ConfigService) {
        this.apiKey = this.configService.get<string>('OPENAI_API_KEY') || '';
        if (!this.apiKey) {
            throw new Error('OPENAI_API_KEY is not defined');
        }
    }

    async handleSerbianCommand(ctx: Context) {
        const messageText = this.getCommandText(ctx);
        if (!messageText) return;

        const query = messageText.split(' ').slice(1).join(' ').trim();
        if (!query) {
            await ctx.reply('Пожалуйста, укажите сербское слово или выражение после команды');
            return;
        }

        try {
            const translation = await this.getTranslation(query);
            await ctx.reply(translation);
        } catch (error) {
            console.error('Error handling Serbian translation:', error);
            await ctx.reply('Произошла ошибка при получении перевода');
        }
    }

    private getCommandText(ctx: Context): string | undefined {
        if ('message' in ctx && ctx.message && 'text' in ctx.message) {
            return ctx.message.text;
        }
        if ('channelPost' in ctx && ctx.channelPost && 'text' in ctx.channelPost) {
            return ctx.channelPost.text;
        }
        return undefined;
    }

    private async getTranslation(serbianText: string): Promise<string> {
        const prompt = `Переведи с сербского на русский слово или выражение: "${serbianText}".
Дай несколько примеров использования этого слова/выражения в предложениях на сербском с переводом на русский.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
} 