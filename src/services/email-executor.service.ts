import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_MAILBOX,
  EmailAccountConfig,
  parseEmailAccounts,
  withMailbox,
} from './email-accounts';

// Reversible actions on a message. mark_read/archive/label touch the mailbox
// over IMAP; hide is dashboard-local. Every action is logged with the prior
// state so it can be undone. No destructive actions by design.
export type EmailAction =
  | 'mark_read'
  | 'mark_unread'
  | 'archive'
  | 'unarchive'
  | 'hide'
  | 'unhide'
  | 'label'
  | 'unlabel';

const GMAIL_INBOX = '\\Inbox';

@Injectable()
export class EmailExecutorService {
  private readonly logger = new Logger(EmailExecutorService.name);
  private readonly accounts: Map<string, EmailAccountConfig>;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.accounts = new Map(
      parseEmailAccounts(
        this.configService.get<string>('EMAIL_ACCOUNTS'),
        (message) => this.logger.error(message),
      ).map((account) => [account.name, account]),
    );
  }

  async apply(
    messageId: number,
    action: EmailAction,
    param?: string,
    source: 'manual' | 'rule' = 'manual',
    ruleId?: number,
  ) {
    const message = await this.prisma.emailMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');

    if ((action === 'label' || action === 'unlabel') && !param?.trim()) {
      throw new NotFoundException('Label name is required');
    }
    const label = param?.trim();

    // State to restore on undo, captured before the change
    const prevState: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};

    try {
      switch (action) {
        case 'mark_read':
        case 'mark_unread': {
          const seen = action === 'mark_read';
          prevState.seen = message.seen;
          await this.imap(message.account, (client) =>
            seen
              ? client.messageFlagsAdd(String(message.uid), ['\\Seen'], {
                  uid: true,
                })
              : client.messageFlagsRemove(String(message.uid), ['\\Seen'], {
                  uid: true,
                }),
          );
          data.seen = seen;
          break;
        }
        case 'archive':
        case 'unarchive': {
          const archived = action === 'archive';
          prevState.archived = message.archived;
          prevState.labels = message.labels;
          // Archiving in Gmail = removing the \Inbox label. Archiving also
          // marks the message read (an archived message shouldn't stay unread).
          const alsoMarkRead = archived && !message.seen;
          if (alsoMarkRead) prevState.seen = message.seen;
          await this.imap(message.account, async (client) => {
            const uid = String(message.uid);
            if (archived) {
              await client.messageFlagsRemove(uid, [GMAIL_INBOX], {
                uid: true,
                useLabels: true,
              });
              if (alsoMarkRead) {
                await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
              }
            } else {
              await client.messageFlagsAdd(uid, [GMAIL_INBOX], {
                uid: true,
                useLabels: true,
              });
            }
          });
          data.archived = archived;
          data.labels = archived
            ? message.labels.filter((l) => l !== GMAIL_INBOX)
            : [...new Set([...message.labels, GMAIL_INBOX])];
          if (alsoMarkRead) data.seen = true;
          break;
        }
        case 'label':
        case 'unlabel': {
          const add = action === 'label';
          prevState.labels = message.labels;
          await this.imap(message.account, (client) =>
            add
              ? client.messageFlagsAdd(String(message.uid), [label!], {
                  uid: true,
                  useLabels: true,
                })
              : client.messageFlagsRemove(String(message.uid), [label!], {
                  uid: true,
                  useLabels: true,
                }),
          );
          data.labels = add
            ? [...new Set([...message.labels, label!])]
            : message.labels.filter((l) => l !== label);
          break;
        }
        case 'hide':
        case 'unhide': {
          // Dashboard-local; no IMAP write
          prevState.hidden = message.hidden;
          data.hidden = action === 'hide';
          break;
        }
      }

      const updated = await this.prisma.emailMessage.update({
        where: { id: messageId },
        data,
      });

      await this.prisma.emailActionLog.create({
        data: {
          messageId,
          action,
          param: label ?? null,
          source,
          ruleId: ruleId ?? null,
          prevState: prevState as object,
          result: 'ok',
        },
      });

      return updated;
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      await this.prisma.emailActionLog.create({
        data: {
          messageId,
          action,
          param: label ?? null,
          source,
          ruleId: ruleId ?? null,
          prevState: prevState as object,
          result: 'error',
          error: messageText,
        },
      });
      this.logger.warn(
        `Action ${action} on message ${messageId} failed: ${messageText}`,
      );
      throw error;
    }
  }

  private async imap<T>(
    account: string,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const config = this.accounts.get(account);
    if (!config) {
      throw new Error(`Account "${account}" is not configured`);
    }
    return withMailbox(config, EMAIL_MAILBOX, fn);
  }
}
