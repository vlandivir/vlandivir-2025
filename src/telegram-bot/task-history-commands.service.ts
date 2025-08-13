import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';
import { v4 as uuidv4 } from 'uuid';
import { formatInTimeZone } from 'date-fns-tz';
import { getUserTimeZone } from '../utils/timezone';
import { TimeZoneCacheService } from '../services/timezone-cache.service';

interface TaskRecord {
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
}

@Injectable()
export class TaskHistoryCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly tzCache: TimeZoneCacheService,
  ) {}

  async handleTaskHistoryCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.reply('Unable to determine chat context');
      return;
    }

    const tasks = await this.prisma.todo.findMany({
      where: {
        chatId,
      },
      orderBy: [{ key: 'asc' }, { createdAt: 'asc' }],
    });

    if (tasks.length === 0) {
      await ctx.reply('No tasks found in this chat');
      return;
    }

    const grouped = this.groupTasks(tasks);

    const keys = grouped.map((g) => g.key);
    const taskNotes = await this.prisma.taskNote.findMany({
      where: { key: { in: keys }, chatId },
      orderBy: { createdAt: 'asc' },
    });
    const notesByKey = taskNotes.reduce<Record<string, { content: string }[]>>(
      (acc, note) => {
        if (!acc[note.key]) acc[note.key] = [];
        acc[note.key].push({ content: note.content });
        return acc;
      },
      {},
    );

    // Load all task images for these keys in one query
    const taskImages = await this.prisma.taskImage.findMany({
      where: { key: { in: keys }, chatId },
      orderBy: { createdAt: 'asc' },
    });
    const imagesByKey = taskImages.reduce<
      Record<string, { url: string; description: string | null }[]>
    >((acc, img) => {
      if (!acc[img.key]) acc[img.key] = [];
      acc[img.key].push({ url: img.url, description: img.description ?? null });
      return acc;
    }, {});

    const unfinished = grouped.filter(
      (g) => !['done', 'canceled', 'snoozed'].includes(g.latest.status),
    );
    const snoozed = grouped.filter((g) => g.latest.status === 'snoozed');
    const finished = grouped.filter((g) =>
      ['done', 'canceled'].includes(g.latest.status),
    );

    unfinished.sort((a, b) => {
      const ad = a.latest.dueDate
        ? new Date(a.latest.dueDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      const bd = b.latest.dueDate
        ? new Date(b.latest.dueDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return a.key.localeCompare(b.key);
    });

    snoozed.sort((a, b) => {
      const ad = a.latest.snoozedUntil
        ? new Date(a.latest.snoozedUntil).getTime()
        : Number.MAX_SAFE_INTEGER;
      const bd = b.latest.snoozedUntil
        ? new Date(b.latest.snoozedUntil).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return a.key.localeCompare(b.key);
    });

    finished.sort(
      (a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime(),
    );

    const chatOrUserId = ctx.chat?.id || ctx.from?.id;
    const tz = this.tzCache.getTimeZone(chatOrUserId) || getUserTimeZone(ctx);
    const html = this.generateHtml(
      unfinished,
      snoozed,
      finished,
      notesByKey,
      imagesByKey,
      tz,
    );
    const id = uuidv4();
    const buffer = Buffer.from(html, 'utf8');
    const url = await this.storageService.uploadFileWithKey(
      buffer,
      'text/html',
      `tasks/${id}.html`,
    );
    await ctx.reply(`Tasks: ${url}`);
  }

  private groupTasks(tasks: TaskRecord[]) {
    const map: Record<string, TaskRecord[]> = {};
    for (const t of tasks) {
      if (!map[t.key]) map[t.key] = [];
      map[t.key].push(t);
    }
    return Object.entries(map).map(([key, recs]) => {
      const sorted = recs.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return { key, history: sorted, latest: sorted[sorted.length - 1] };
    });
  }

  private generateHtml(
    unfinished: {
      key: string;
      history: TaskRecord[];
      latest: TaskRecord;
    }[],
    snoozed: { key: string; history: TaskRecord[]; latest: TaskRecord }[],
    finished: { key: string; history: TaskRecord[]; latest: TaskRecord }[],
    notesByKey: Record<string, { content: string }[]>,
    imagesByKey: Record<string, { url: string; description: string | null }[]>,
    timeZone: string,
  ): string {
    let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Tasks</title><style>body{font-family:Arial,Helvetica,sans-serif;margin:20px;}h2{color:#333;} .task{border:1px solid #ccc;padding:10px;margin-bottom:10px;border-radius:6px;} .history{margin-top:5px;padding-left:20px;font-size:0.9em;color:#555;} .images{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,400px));gap:10px;margin-top:10px;justify-content:center;} .notes{column-width:400px;column-gap:10px;margin-top:10px;} .polaroid{background:#fff;padding:10px;box-shadow:0 2px 5px rgba(0,0,0,0.3);text-align:center;} .images .polaroid{max-width:400px;margin:auto;} .notes .polaroid{display:inline-block;width:400px;margin:0 0 10px;} .polaroid img{max-width:100%;max-height:400px;height:auto;} .polaroid .caption{margin-top:5px;font-size:0.9em;} .note{white-space:pre-wrap;text-align:left;}</style></head><body>`;
    html += '<h1>Tasks</h1>';
    html += '<h2>Unfinished</h2>';
    html += this.renderTasks(unfinished, notesByKey, imagesByKey, timeZone);
    html += '<h2>Snoozed</h2>';
    html += this.renderTasks(snoozed, notesByKey, imagesByKey, timeZone);
    html += '<h2>Finished</h2>';
    html += this.renderTasks(finished, notesByKey, imagesByKey, timeZone);
    html += `<p>Generated: ${formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd HH:mm:ss')}</p>`;
    html += '</body></html>';
    return html;
  }

  private renderTasks(
    groups: { key: string; history: TaskRecord[]; latest: TaskRecord }[],
    notesByKey: Record<string, { content: string }[]>,
    imagesByKey: Record<string, { url: string; description: string | null }[]>,
    timeZone: string,
  ): string {
    let html = '';
    for (const g of groups) {
      const t = g.latest;
      html += `<div class="task"><strong>${g.key}</strong> - ${this.escapeHtml(t.content)}`;
      if (t.priority) html += ` [${t.priority}]`;
      if (t.status) html += ` (${t.status})`;
      if (t.dueDate)
        html += ` (due: ${formatInTimeZone(
          new Date(t.dueDate),
          timeZone,
          'yyyy-MM-dd HH:mm',
        )})`;
      if (t.snoozedUntil)
        html += ` (snoozed until: ${formatInTimeZone(
          new Date(t.snoozedUntil),
          timeZone,
          'yyyy-MM-dd HH:mm',
        )})`;
      if (t.tags.length) html += ` tags: ${t.tags.join(', ')}`;
      if (t.contexts.length) html += ` contexts: ${t.contexts.join(', ')}`;
      if (t.projects.length) html += ` projects: ${t.projects.join(', ')}`;
      // Aggregate all unique images for this task by key (from TaskImage table)
      const uniqueImagesByUrl = new Map<
        string,
        { url: string; description: string | null }
      >();
      const imgs = imagesByKey[g.key] || [];
      for (const img of imgs) {
        if (!uniqueImagesByUrl.has(img.url)) {
          uniqueImagesByUrl.set(img.url, {
            url: img.url,
            description: img.description ?? null,
          });
        }
      }
      const allImages = Array.from(uniqueImagesByUrl.values());
      if (allImages.length) {
        html += '<div class="images">';
        for (const img of allImages) {
          html += '<div class="polaroid">';
          html += `<img src="${img.url}"/>`;
          if (img.description) {
            html += `<div class="caption">${this.escapeHtml(img.description)}</div>`;
          }
          html += '</div>';
        }
        html += '</div>';
      }

      const notes = notesByKey[g.key] || [];
      if (notes.length) {
        html += '<div class="notes">';
        for (const n of notes) {
          html += `<div class="polaroid note">${this.escapeHtml(n.content)}</div>`;
        }
        html += '</div>';
      }

      html += '<div class="history"><ul>';
      for (let i = 0; i < g.history.length; i++) {
        const h = g.history[i];
        html += `<li>${formatInTimeZone(
          new Date(h.createdAt),
          timeZone,
          'yyyy-MM-dd HH:mm',
        )} - `;
        if (i === 0) {
          html += `created: ${this.escapeHtml(h.content)}`;
        } else {
          const prev = g.history[i - 1];
          const changes = this.describeChanges(prev, h, timeZone);
          html += changes || 'no changes';
        }
        html += '</li>';
      }
      html += '</ul></div></div>\n<br/>';
    }
    return html;
  }

  private describeChanges(
    prev: TaskRecord,
    curr: TaskRecord,
    timeZone: string,
  ): string {
    const changes: string[] = [];
    if (prev.content !== curr.content) {
      changes.push(`content: ${this.escapeHtml(curr.content)}`);
    }
    if (prev.priority !== curr.priority) {
      changes.push(`priority: ${curr.priority ?? 'none'}`);
    }
    if (prev.status !== curr.status) {
      changes.push(`status: ${curr.status}`);
    }
    const prevDue = prev.dueDate ? prev.dueDate.getTime() : 0;
    const currDue = curr.dueDate ? curr.dueDate.getTime() : 0;
    if (prevDue !== currDue) {
      changes.push(
        `due: ${
          curr.dueDate
            ? formatInTimeZone(
                new Date(curr.dueDate),
                timeZone,
                'yyyy-MM-dd HH:mm',
              )
            : 'none'
        }`,
      );
    }
    const prevSnoozed = prev.snoozedUntil ? prev.snoozedUntil.getTime() : 0;
    const currSnoozed = curr.snoozedUntil ? curr.snoozedUntil.getTime() : 0;
    if (prevSnoozed !== currSnoozed) {
      changes.push(
        `snoozed until: ${
          curr.snoozedUntil
            ? formatInTimeZone(
                new Date(curr.snoozedUntil),
                timeZone,
                'yyyy-MM-dd HH:mm',
              )
            : 'none'
        }`,
      );
    }
    if (!this.arraysEqual(prev.tags, curr.tags)) {
      changes.push(`tags: ${curr.tags.join(', ')}`);
    }
    if (!this.arraysEqual(prev.contexts, curr.contexts)) {
      changes.push(`contexts: ${curr.contexts.join(', ')}`);
    }
    if (!this.arraysEqual(prev.projects, curr.projects)) {
      changes.push(`projects: ${curr.projects.join(', ')}`);
    }
    return changes.join('; ');
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
