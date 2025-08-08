import { Controller, Get, Header, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

type TelegramInitData = {
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  chat_type?: string;
  chat_instance?: string;
  auth_date?: string;
  hash: string;
};

@Controller('mini-app')
export class MiniAppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  index(): string {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mini App</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body { font-family: -apple-system, Inter, Arial, sans-serif; margin: 0; padding: 16px; color: var(--tg-theme-text-color); background: var(--tg-theme-bg-color); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    pre { white-space: pre-wrap; word-wrap: break-word; background: rgba(0,0,0,0.05); padding: 12px; border-radius: 8px; }
    .card { border-radius: 12px; padding: 16px; background: var(--tg-theme-secondary-bg-color); }
  </style>
</head>
<body>
  <h1>Mini App</h1>
  <div id="content" class="card">Loading...</div>
  <script>
    const tg = window.Telegram?.WebApp;
    tg?.expand();
    async function load() {
      try {
        const res = await fetch('/mini-app/user?initData=' + encodeURIComponent(tg?.initData || ''));
        const data = await res.json();
        const el = document.getElementById('content');
        if (data.error) { el.textContent = 'Error: ' + data.error; return; }
        el.innerHTML = '<b>User</b>: ' + data.userSummary + '<br/><br/>' +
          '<b>Notes</b>: ' + data.counts.notes + '\n' +
          '<br/><b>Todos</b>: ' + data.counts.todos + '\n' +
          '<br/><b>Questions</b>: ' + data.counts.questions + '\n' +
          '<br/><b>Answers</b>: ' + data.counts.answers + '\n';
      } catch (e) {
        document.getElementById('content').textContent = 'Failed to load';
      }
    }
    load();
  </script>
  </body>
</html>`;
    return html;
  }

  @Get('user')
  async getUser(@Query('initData') initData?: string) {
    try {
      const parsed = this.parseAndVerifyInitData(initData || '');
      const userId = parsed.user?.id;
      if (!userId) return { error: 'No user' };

      // userId is number; in DB chatId is BigInt. Use BigInt for filtering
      const chatId = BigInt(userId);
      const [notes, todos, questions, answers] = await Promise.all([
        this.prisma.note.count({ where: { chatId } }),
        this.prisma.todo.count({ where: { chatId } }),
        this.prisma.question.count({ where: { chatId } }),
        this.prisma.answer.count(),
      ]);

      const userSummary = [
        parsed.user?.first_name,
        parsed.user?.last_name,
        parsed.user?.username ? '(' + parsed.user?.username + ')' : undefined,
      ]
        .filter(Boolean)
        .join(' ');

      return {
        userId,
        userSummary,
        counts: { notes, todos, questions, answers },
      };
    } catch (e) {
      return { error: `Invalid initData ${e}` };
    }
  }

  private parseAndVerifyInitData(raw: string): TelegramInitData {
    // Based on https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('No token');
    const urlParams = new URLSearchParams(raw);
    const hash = urlParams.get('hash') || '';
    const dataCheckString = Array.from(urlParams.entries())
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(token)
      .digest();
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    if (calculatedHash !== hash) throw new Error('Bad hash');

    const result: TelegramInitData = { hash } as TelegramInitData;
    const userString = urlParams.get('user');
    if (userString) {
      try {
        result.user = JSON.parse(userString);
      } catch {
        // ignore
      }
    }
    result.auth_date = urlParams.get('auth_date') || undefined;
    result.chat_type = urlParams.get('chat_type') || undefined;
    result.chat_instance = urlParams.get('chat_instance') || undefined;
    return result;
  }
}
