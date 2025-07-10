import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { parse, isValid, format, startOfDay, endOfDay } from 'date-fns';

interface ParsedTask {
    content: string;
    priority?: string;
    tags: string[];
    contexts: string[];
    projects: string[];
    dueDate?: Date;
}

@Injectable()
export class TaskCommandsService {
    constructor(private prisma: PrismaService) {}

    async handleTaskCommand(ctx: Context) {
        const text = this.getCommandText(ctx);
        if (!text) return;
        const withoutCommand = text.replace(/^\/(t|task)\s*/, '').trim();
        const parsed = this.parseTask(withoutCommand);
        if (!parsed.content) {
            await ctx.reply('Task text cannot be empty');
            return;
        }
        const key = await this.generateKey();
        await this.prisma.todo.create({
            data: {
                key,
                content: parsed.content,
                priority: parsed.priority,
                dueDate: parsed.dueDate,
                tags: parsed.tags,
                contexts: parsed.contexts,
                projects: parsed.projects,
            },
        });
        await ctx.reply(`Task created with key ${key}`);
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

    private parseTask(text: string): ParsedTask {
        const tokens = text.split(/\s+/);
        const tags: string[] = [];
        const contexts: string[] = [];
        const projects: string[] = [];
        let priority: string | undefined;
        let dueDate: Date | undefined;
        const descParts: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (/^\([a-zA-Z]\)$/.test(token)) {
                priority = token.slice(1, 2).toUpperCase();
                continue;
            }
            if (token.startsWith('@')) {
                tags.push(token.slice(1));
                continue;
            }
            if (token.startsWith('.')) {
                contexts.push(token.slice(1));
                continue;
            }
            if (token.startsWith('!')) {
                let project = token.slice(1);
                while (i + 1 < tokens.length && !tokens[i + 1].startsWith('@') && !tokens[i + 1].startsWith('.') && !tokens[i + 1].startsWith('!') && !tokens[i + 1].startsWith(':') && !/^\([a-zA-Z]\)$/.test(tokens[i + 1])) {
                    project += ' ' + tokens[i + 1];
                    i++;
                }
                projects.push(project);
                continue;
            }
            if (token.startsWith(':')) {
                let dateStr = token.slice(1);
                if (i + 1 < tokens.length && /\d{2}:\d{2}/.test(tokens[i + 1])) {
                    dateStr += ' ' + tokens[i + 1];
                    i++;
                }
                const parsed = this.parseDueDate(dateStr);
                if (parsed) {
                    dueDate = parsed;
                }
                continue;
            }
            descParts.push(token);
        }
        return {
            content: descParts.join(' ').trim(),
            priority,
            tags,
            contexts,
            projects,
            dueDate,
        };
    }

    private parseDueDate(text: string): Date | undefined {
        const formats = ['yyyy.MM.dd HH:mm', 'yyyy.MM.dd'];
        for (const fmt of formats) {
            const d = parse(text, fmt, new Date());
            if (isValid(d)) return d;
        }
        return undefined;
    }

    private async generateKey(): Promise<string> {
        const today = new Date();
        const datePart = format(today, 'yyyyMMdd');
        const count = await this.prisma.todo.count({
            where: { createdAt: { gte: startOfDay(today), lt: endOfDay(today) } },
        });
        return `T-${datePart}-${count + 1}`;
    }
}
