import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GoogleSessionGuard } from './auth/google-session.guard';
import { PrismaService } from './prisma/prisma.service';
import { EmailIngestService } from './services/email-ingest.service';
import {
  EmailAction,
  EmailExecutorService,
} from './services/email-executor.service';

const LIST_LIMIT = 500;

const ALLOWED_ACTIONS: EmailAction[] = [
  'mark_read',
  'mark_unread',
  'archive',
  'unarchive',
  'hide',
  'unhide',
  'label',
  'unlabel',
];

// Read-only dashboard API for the email pipeline (page: /email). Session
// only — unlike map/reels there is no machine-key use case here yet.
@UseGuards(GoogleSessionGuard)
@Controller('email-api')
export class EmailApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailIngestService: EmailIngestService,
    private readonly emailExecutorService: EmailExecutorService,
  ) {}

  // Per-account counters + cursor state for the stats cards
  @Get('stats')
  async stats() {
    const [states, counts, unseen, lastMessages] = await Promise.all([
      this.prisma.emailSyncState.findMany({ orderBy: { account: 'asc' } }),
      this.prisma.emailMessage.groupBy({
        by: ['account', 'status'],
        _count: { _all: true },
      }),
      this.prisma.emailMessage.groupBy({
        by: ['account'],
        where: { seen: false },
        _count: { _all: true },
      }),
      this.prisma.emailMessage.groupBy({
        by: ['account'],
        _max: { date: true },
      }),
    ]);

    const accounts = states.map((state) => {
      const statuses: Record<string, number> = {};
      let total = 0;
      for (const row of counts) {
        if (row.account !== state.account) continue;
        statuses[row.status] = row._count._all;
        total += row._count._all;
      }
      return {
        account: state.account,
        mailbox: state.mailbox,
        lastUid: String(state.lastUid),
        syncedAt: state.updatedAt,
        total,
        statuses,
        unseen:
          unseen.find((row) => row.account === state.account)?._count._all ?? 0,
        lastMessageAt:
          lastMessages.find((row) => row.account === state.account)?._max
            .date ?? null,
      };
    });

    return { accounts };
  }

  // Latest messages; filtering happens client-side on this window
  @Get('messages')
  async messages(@Query('limit') limit: string | undefined) {
    const take = Math.min(Number(limit) || LIST_LIMIT, LIST_LIMIT);
    const messages = await this.prisma.emailMessage.findMany({
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        account: true,
        threadId: true,
        fromAddress: true,
        fromName: true,
        subject: true,
        date: true,
        snippet: true,
        labels: true,
        seen: true,
        archived: true,
        hidden: true,
        hasAttachments: true,
        status: true,
      },
    });
    return { messages };
  }

  // Distinct Gmail labels seen across messages, for the label picker
  @Get('labels')
  async labels() {
    const rows = await this.prisma.$queryRaw<{ label: string }[]>`
      SELECT DISTINCT unnest(labels) AS label FROM "EmailMessage" ORDER BY label
    `;
    return { labels: rows.map((row) => row.label) };
  }

  // Apply a reversible action to a message (manual, from the dashboard)
  @Post('messages/:id/action')
  async action(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { action?: string; param?: string },
  ) {
    const action = body.action as EmailAction;
    if (!ALLOWED_ACTIONS.includes(action)) {
      throw new BadRequestException(`Unknown action: ${body.action}`);
    }
    const updated = await this.emailExecutorService.apply(
      id,
      action,
      body.param,
    );
    return {
      id: updated.id,
      seen: updated.seen,
      archived: updated.archived,
      hidden: updated.hidden,
      labels: updated.labels,
    };
  }

  @Get('messages/:id')
  async message(@Param('id', ParseIntPipe) id: number) {
    const message = await this.prisma.emailMessage.findUnique({
      where: { id },
      select: {
        id: true,
        account: true,
        threadId: true,
        mailbox: true,
        messageId: true,
        fromAddress: true,
        fromName: true,
        toAddresses: true,
        ccAddresses: true,
        subject: true,
        date: true,
        bodyText: true,
        labels: true,
        seen: true,
        archived: true,
        hidden: true,
        hasAttachments: true,
        sizeBytes: true,
        status: true,
        rawKey: true,
        attachments: {
          select: {
            id: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            inline: true,
          },
        },
        thread: {
          select: {
            id: true,
            gmThreadId: true,
            subject: true,
            messages: {
              orderBy: { date: 'asc' },
              select: {
                id: true,
                fromAddress: true,
                subject: true,
                date: true,
                seen: true,
              },
            },
          },
        },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  // Manual sync round for all configured accounts; the poller keeps running
  // on its own schedule regardless.
  @Post('sync')
  async sync() {
    const results = await this.emailIngestService.syncAll();
    return { results };
  }
}
