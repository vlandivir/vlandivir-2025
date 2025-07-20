import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { format, startOfDay, endOfDay } from 'date-fns';
import { DateParserService } from '../services/date-parser.service';

interface ParsedTask {
    content: string;
    priority?: string;
    tags: string[];
    contexts: string[];
    projects: string[];
    dueDate?: Date;
    status?: string;
    snoozedUntil?: Date;
}

@Injectable()
export class TaskCommandsService {
    constructor(
        private prisma: PrismaService,
        private dateParser: DateParserService,
    ) {}

    async handleTaskCommand(ctx: Context) {
        const text = this.getCommandText(ctx);
        if (!text) return;
        
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.reply('Unable to determine chat context');
            return;
        }

        const withoutCommand = text.replace(/^\/(t|task)\s*/, '').trim();
        if (!withoutCommand) {
            await ctx.reply(this.getTaskFormatMessage());
            return;
        }
        const parts = withoutCommand.split(/\s+/);
        let key: string | undefined;
        if (parts.length && /^T-\d{8}-\d+$/.test(parts[0])) {
            key = parts.shift() as string;
        }
        const parsed = this.parseTask(parts.join(' '));

        if (key) {
            await this.editTask(ctx, key, parsed);
            return;
        }

        if (!parsed.content) {
            await ctx.reply('Task text cannot be empty');
            return;
        }

        const newKey = await this.generateKey(chatId);
        await this.prisma.todo.create({
            data: {
                key: newKey,
                content: parsed.content,
                priority: parsed.priority,
                dueDate: parsed.dueDate,
                snoozedUntil: parsed.snoozedUntil,
                tags: parsed.tags,
                contexts: parsed.contexts,
                projects: parsed.projects,
                status: parsed.status ?? 'new',
                chatId: chatId,
            },
        });
        await ctx.reply(`Task created with key ${newKey}`);
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

    private parseFilters(text: string): { tags: string[]; contexts: string[]; projects: string[]; remaining: string[] } {
        const tokens = text.split(/\s+/).filter(t => t);
        const tags: string[] = [];
        const contexts: string[] = [];
        const projects: string[] = [];
        const remaining: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
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
                while (i + 1 < tokens.length &&
                    !tokens[i + 1].startsWith('@') &&
                    !tokens[i + 1].startsWith('.') &&
                    !tokens[i + 1].startsWith('!') &&
                    !tokens[i + 1].startsWith(':') &&
                    !/^\([a-zA-Z]\)$/.test(tokens[i + 1])) {
                    project += ' ' + tokens[i + 1];
                    i++;
                }
                projects.push(project);
                continue;
            }
            remaining.push(token);
        }
        return { tags, contexts, projects, remaining };
    }

    private parseTask(text: string): ParsedTask {
        const { tags, contexts, projects, remaining } = this.parseFilters(text);
        const tokens = remaining;
        let priority: string | undefined;
        let dueDate: Date | undefined;
        let status: string | undefined;
        let snoozedUntil: Date | undefined;
        const descParts: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.startsWith('-')) {
                const st = token.slice(1);
                if (['canceled', 'done', 'in-progress', 'started'].includes(st)) {
                    status = st;
                    continue;
                }
                // Handle -snoozed[number] syntax (e.g., -snoozed4)
                const snoozedMatch = st.match(/^snoozed(\d+)$/);
                if (snoozedMatch) {
                    status = 'snoozed';
                    const days = parseInt(snoozedMatch[1], 10);
                    snoozedUntil = new Date();
                    snoozedUntil.setDate(snoozedUntil.getDate() + days);
                    continue;
                }
                // Handle -snoozed followed by a separate number token (e.g., -snoozed 4)
                if (st === 'snoozed' && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
                    status = 'snoozed';
                    const days = parseInt(tokens[i + 1], 10);
                    snoozedUntil = new Date();
                    snoozedUntil.setDate(snoozedUntil.getDate() + days);
                    i++; // Skip the next token since we consumed it
                    continue;
                }
            }
            if (/^\([a-zA-Z]\)$/.test(token)) {
                priority = token.slice(1, 2).toUpperCase();
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
            status,
            snoozedUntil,
        };
    }

    private parseDueDate(text: string): Date | undefined {
        const timeMatch = text.match(/(\d{1,2}:\d{2})$/);
        const datePart = timeMatch ? text.replace(timeMatch[0], '').trim() : text.trim();
        const { date } = this.dateParser.extractDateFromFirstLine(datePart);
        if (!date) return undefined;

        if (timeMatch) {
            const [h, m] = timeMatch[1].split(':').map(Number);
            date.setHours(h, m, 0, 0);
        }

        return date;
    }

    private async editTask(ctx: Context, key: string, updates: ParsedTask) {
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.reply('Unable to determine chat context');
            return;
        }

        const existing = await this.prisma.todo.findFirst({
            where: { 
                key,
                chatId: chatId
            },
            orderBy: { createdAt: 'desc' },
        });
        if (!existing) {
            await ctx.reply(`Task with key ${key} not found in this chat`);
            return;
        }

        const data = {
            key,
            content: updates.content || existing.content,
            priority: updates.priority ?? existing.priority,
            dueDate: updates.dueDate ?? existing.dueDate,
            snoozedUntil: updates.snoozedUntil ?? existing.snoozedUntil,
            tags: Array.from(new Set([...existing.tags, ...updates.tags])),
            contexts: Array.from(new Set([...existing.contexts, ...updates.contexts])),
            projects: updates.projects.length > 0 ? updates.projects : existing.projects,
            status: updates.status ?? existing.status,
            chatId: chatId,
        };

        await this.prisma.todo.create({ data });
        await ctx.reply(`Task ${key} updated`);
    }

    private async generateKey(chatId: number): Promise<string> {
        const today = new Date();
        const datePart = format(today, 'yyyyMMdd');
        const count = await this.prisma.todo.count({
            where: {
                createdAt: { gte: startOfDay(today), lt: endOfDay(today) },
                chatId: chatId
            },
        });
        const index = count + 1;
        const indexStr = index.toString().padStart(2, '0');
        return `T-${datePart}-${indexStr}`;
    }

    async handleListCommand(ctx: Context) {
        const text = this.getCommandText(ctx) || '';
        const withoutCommand = text.replace(/^\/tl\s*/, '').trim();
        const { tags, contexts, projects } = this.parseFilters(withoutCommand);

        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.reply('Unable to determine chat context');
            return;
        }

        // Build the complete query as a template literal
        let query = `
            WITH latest_todos AS (
                SELECT *,
                       ROW_NUMBER() OVER (PARTITION BY key ORDER BY id DESC) as rn
                FROM "Todo"
                WHERE "chatId" = ${chatId}
            )
            SELECT id, key, content, "createdAt", status, "completedAt", priority, "dueDate", "snoozedUntil", tags, contexts, projects
            FROM latest_todos
            WHERE rn = 1 
              AND status NOT IN ('done', 'canceled')
              AND (status != 'snoozed' OR "snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())`;

        if (tags.length > 0) {
            query += ` AND tags @> '${JSON.stringify(tags)}'::jsonb`;
        }

        if (contexts.length > 0) {
            query += ` AND contexts @> '${JSON.stringify(contexts)}'::jsonb`;
        }

        if (projects.length > 0) {
            query += ` AND projects @> '${JSON.stringify(projects)}'::jsonb`;
        }

        query += ` ORDER BY "dueDate" IS NULL, "dueDate" ASC, "createdAt" DESC, key ASC`;

        // Use CTE to get latest record for each key, then apply filters
        const latestTasks = await this.prisma.$queryRawUnsafe<Array<{
            id: number;
            key: string;
            content: string;
            createdAt: Date;
            status: string;
            completedAt: Date | null;
            priority: string | null;
            dueDate: Date | null;
            snoozedUntil: Date | null;
            tags: string[];
            contexts: string[];
            projects: string[];
        }>>(query);

        if (latestTasks.length === 0) {
            await ctx.reply('No tasks found in this chat');
            return;
        }

        const lines = latestTasks.map(t => {
            let line = `${t.key} ${t.content}`;
            if (t.dueDate) {
                line += ` (due: ${format(t.dueDate, 'MMM d, yyyy HH:mm')})`;
            }
            return line;
        });
        await ctx.reply(lines.join('\n'));
    }

    private getTaskFormatMessage(): string {
        return [
            'Format:',
            '/t [T-YYYYMMDD-NN] (-status) @tag .context !project (A) :<date> text',
            'Status options: -done, -canceled, -in-progress, -started, -snoozed[days] or -snoozed [days]',
            'Example: /task (B) @work .office !Big Project :2025.07.31 09:00 Prepare report',
            'Snooze examples: /task T-20250715-01 -snoozed4 or /task T-20250715-01 -snoozed 4'
        ].join('\n');
    }
}
