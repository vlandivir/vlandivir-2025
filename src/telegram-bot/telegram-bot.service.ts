import { Injectable } from '@nestjs/common';
import {
  Update,
  Message,
  CallbackQuery,
} from 'telegraf/typings/core/types/typegram';
import { Telegraf, Context, Scenes, session } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma-client';
import { DateParserService } from '../services/date-parser.service';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { message, channelPost } from 'telegraf/filters';
import { DairyCommandsService } from './dairy-commands.service';
import { StorageService } from '../services/storage.service';
import { LlmService } from '../services/llm.service';
import { SerbianCommandsService } from './serbian-commands.service';
import { ForeignCommandsService } from './foreign-commands.service';
import { HistoryCommandsService } from './history-commands.service';
import { TaskCommandsService } from './task-commands.service';
import { TaskHistoryCommandsService } from './task-history-commands.service';
import { CollageCommandsService } from './collage-commands.service';
import { QaCommandsService } from './qa-commands.service';
// import { getUserTimeZone } from '../utils/timezone';
import {
  createTaskEditScene,
  TaskEditWizardContext,
} from './scenes/task-edit.scene';
import { Readable } from 'stream';

// Telegram Bot API limitation: bots cannot download files larger than ~20 MB via getFile
const MAX_TELEGRAM_FILE_DOWNLOAD_BYTES = 20 * 1024 * 1024;

type TelegramUpdate =
  | Update.CallbackQueryUpdate
  | Update.MessageUpdate
  | { channel_post: Message.TextMessage };

@Injectable()
export class TelegramBotService {
  private readonly bot: Telegraf<TaskEditWizardContext>;
  private readonly stage: Scenes.Stage<TaskEditWizardContext>;

  // Маппинг каналов к создателям (дополнительный механизм)
  private readonly channelCreatorMapping: Map<number, number> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly dateParser: DateParserService,
    private readonly dairyCommands: DairyCommandsService,
    private readonly storageService: StorageService,
    private readonly llmService: LlmService,
    private readonly serbianCommands: SerbianCommandsService,
    private readonly foreignCommands: ForeignCommandsService,
    private readonly historyCommands: HistoryCommandsService,
    private readonly taskCommands: TaskCommandsService,
    private readonly taskHistoryCommands: TaskHistoryCommandsService,
    private readonly collageCommands: CollageCommandsService,
    private readonly qaCommands: QaCommandsService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined');
    }
    this.bot = new Telegraf<TaskEditWizardContext>(token);
    this.stage = new Scenes.Stage<TaskEditWizardContext>([
      createTaskEditScene(this.taskCommands),
    ]);

    this.bot.use(session());
    this.bot.use(this.stage.middleware());

    // Добавляем middleware для логирования
    this.bot.use((ctx, next) => {
      const { updateType } = ctx;
      const chatType = ctx.chat?.type;
      console.log(
        `Получено обновление типа [${updateType}] из чата типа [${chatType}]`,
      );
      return next();
    });

    this.setupCommands();

    // Инициализируем маппинг для известных каналов
    // VlandivirTestChannel -> creator ID 150847737
    this.addChannelCreatorMapping(-1001594248060, 150847737);
    this.addChannelCreatorMapping(-1002251325012, 150847737);
    this.addChannelCreatorMapping(-1002259110541, 150847737);
  }

  startBot() {
    // Заменяем launch() на webhook
    const webhookUrl = this.configService.get<string>(
      'VLANDIVIR_2025_WEBHOOK_URL',
    ); // например, https://your-domain.com/telegram-bot
    if (!webhookUrl) {
      throw new Error('VLANDIVIR_2025_WEBHOOK_URL is not defined');
    }

    // Устанавливаем webhook вместо запуска long polling
    void this.bot.telegram.setWebhook(webhookUrl);
    console.log('Telegram bot webhook set to:', webhookUrl);
  }

  stopBot() {
    this.bot.stop();
  }

  private setupCommands() {
    // Регистрируем команды для личных чатов и групп
    this.bot.command(['dairy', 'd'], (ctx) => {
      console.log('Получена команда /dairy /d:', ctx.message?.text);
      return this.dairyCommands.handleDairyCommand(ctx);
    });

    // Регистрируем те же команды для каналов
    this.bot.on(channelPost('text'), async (ctx) => {
      console.log('Получено сообщение из канала:', {
        text: ctx.channelPost.text,
        from: ctx.channelPost.from,
        chat: ctx.chat,
      });

      if (
        ctx.channelPost.text.startsWith('/d') ||
        ctx.channelPost.text.startsWith('/dairy')
      ) {
        console.log('Обработка команды /dairy /d из канала');
        await this.dairyCommands.handleDairyCommand(ctx);
        return;
      }
      const update = {
        channel_post: ctx.channelPost,
      } as TelegramUpdate;
      await this.handleIncomingMessage(ctx.chat.id, update, true);
    });

    // Add the new Serbian translation command
    this.bot.command(['s'], (ctx) => {
      console.log('Получена команда /s:', ctx.message?.text);
      return this.serbianCommands.handleSerbianCommand(ctx);
    });

    // Add the new foreign translation command
    this.bot.command(['f'], (ctx) => {
      console.log('Получена команда /f:', ctx.message?.text);
      return this.foreignCommands.handleForeignCommand(ctx);
    });

    // Add the new history command
    this.bot.command(['history'], (ctx) => {
      console.log('Получена команда /history:', ctx.message?.text);
      return this.historyCommands.handleHistoryCommand(ctx);
    });

    // Add the new task command
    this.bot.command(['t', 'task'], (ctx) => {
      console.log('Получена команда /t /task:', ctx.message?.text);
      return this.taskCommands.handleTaskCommand(ctx);
    });

    // Set timezone command
    this.bot.command(['tz'], async (ctx) => {
      const text = ctx.message?.text || '';
      const arg = text.replace(/^\/tz\s+/, '').trim();
      if (!arg) {
        await ctx.reply(
          'Usage: /tz <IANA tz or UTC±HH[:MM]>. Example: /tz Europe/Belgrade or /tz UTC+2',
        );
        return;
      }
      // Normalize and validate timezone
      const normalized = (() => {
        const m = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(arg);
        if (m) {
          const sign = m[1];
          const hh = String(
            Math.min(14, Math.max(0, parseInt(m[2], 10))),
          ).padStart(2, '0');
          const mm = String(
            Math.min(59, Math.max(0, m[3] ? parseInt(m[3], 10) : 0)),
          ).padStart(2, '0');
          return `UTC${sign}${hh}:${mm}`;
        }
        try {
          // simple validation using Intl; fall back to date-fns-tz in strict mode if needed
          Intl.DateTimeFormat(undefined, { timeZone: arg });
          return arg;
        } catch {
          return null;
        }
      })();
      if (!normalized) {
        await ctx.reply(
          'Invalid timezone. Use IANA tz (e.g., Europe/Belgrade) or UTC±HH[:MM].',
        );
        return;
      }
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await ctx.reply('Unable to determine chat.');
        return;
      }
      try {
        await this.prisma.chatSettings.upsert({
          where: { chatId: BigInt(chatId) },
          update: { timeZone: normalized },
          create: { chatId: BigInt(chatId), timeZone: normalized },
        });
        await ctx.reply(
          `Timezone set to: ${normalized}. I will use it for /tl and /th.`,
        );
      } catch (e) {
        console.error('Failed to save timezone', e);
        await ctx.reply('Failed to save timezone. Please try again later.');
      }
    });

    // Task list command
    this.bot.command(['tl'], async (ctx) => {
      console.log('Получена команда /tl:', ctx.message?.text);
      try {
        const rec = await this.prisma.chatSettings.findUnique({
          where: { chatId: BigInt(ctx.chat?.id || 0) },
        });
        if (!rec?.timeZone) {
          await ctx.reply(
            'Please set your time zone with /tz <IANA tz or UTC±HH[:MM]>. Example: /tz Europe/Belgrade. You can also use /tl tz=<IANA tz> once.',
          );
        }
      } catch (e) {
        console.error('Error reading chat settings', e);
        await ctx.reply(
          'Error reading timezone settings. Please try again later.',
        );
      }
      try {
        return this.taskCommands.handleListCommand(ctx);
      } catch (e) {
        console.error('Error handling list command', e);
        await ctx.reply('Error handling list command. Please try again later.');
      }
    });

    // Task history HTML command
    this.bot.command(['th'], async (ctx) => {
      console.log('Получена команда /th:', ctx.message?.text);
      try {
        const rec = await this.prisma.chatSettings.findUnique({
          where: { chatId: BigInt(ctx.chat?.id || 0) },
        });
        if (!rec?.timeZone) {
          await ctx.reply(
            'Please set your time zone first with /tz <IANA tz or UTC±HH[:MM]>. Example: /tz Europe/Belgrade',
          );
        }
      } catch (e) {
        console.error('Error reading chat settings', e);
        await ctx.reply(
          'Error reading timezone settings. Please try again later.',
        );
      }
      try {
        return this.taskHistoryCommands.handleTaskHistoryCommand(ctx);
      } catch (e) {
        console.error('Error handling task history command', e);
        await ctx.reply(
          'Error handling task history command. Please try again later.',
        );
      }
    });

    // Mini app command
    this.bot.command(['a'], async (ctx) => {
      try {
        const webhookUrl = this.configService.get<string>(
          'VLANDIVIR_2025_WEBHOOK_URL',
        );
        if (!webhookUrl) {
          await ctx.reply('Mini app URL is not configured');
          return;
        }
        const baseUrl = new URL(webhookUrl).origin;
        const appUrl = `${baseUrl}/mini-app`;
        await ctx.reply('Откройте мини‑приложение:', {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Open Mini App',
                  web_app: { url: appUrl },
                },
              ],
            ],
          },
        });
      } catch (error) {
        console.error('Error sending mini app button', error);
        await ctx.reply('Не удалось открыть мини‑приложение');
      }
    });

    // Add new question command
    this.bot.command(['qa'], (ctx) => {
      console.log('Получена команда /qa:', ctx.message?.text);
      return this.qaCommands.handleQaCommand(ctx);
    });

    // List questions command
    this.bot.command(['ql'], (ctx) => {
      console.log('Получена команда /ql:', ctx.message?.text);
      return this.qaCommands.handleQlCommand(ctx);
    });

    // Ask questions command
    this.bot.command(['q'], (ctx) => {
      console.log('Получена команда /q:', ctx.message?.text);
      return this.qaCommands.handleQCommand(ctx);
    });

    // Questions report command
    this.bot.command(['qq'], (ctx) => {
      console.log('Получена команда /qq:', ctx.message?.text);
      return this.qaCommands.handleQqCommand(ctx);
    });

    // Questions history command
    this.bot.command(['qh'], (ctx) => {
      console.log('Получена команда /qh:', ctx.message?.text);
      return this.qaCommands.handleQhCommand(ctx);
    });

    // Save video by direct URL (workaround for >20MB Telegram getFile limit)
    this.bot.command(['v', 'video'], async (ctx) => {
      try {
        const text = ctx.message?.text || '';
        const args = text.replace(/^\/(v|video)\s*/i, '').trim();
        if (!args) {
          await ctx.reply('Usage: /v <direct video URL> [optional caption]');
          return;
        }
        const parts = args.split(/\s+/);
        const urlCandidate = parts[0];
        let videoUrlInput: URL;
        try {
          videoUrlInput = new URL(urlCandidate);
        } catch {
          await ctx.reply(
            'Invalid URL. Usage: /v <direct video URL> [caption]',
          );
          return;
        }
        const caption = parts.slice(1).join(' ');
        await this.handleVideoByUrl(ctx, videoUrlInput.toString(), caption);
      } catch (e) {
        console.error('Error in /v command', e);
        await ctx.reply('Ошибка при сохранении видео по ссылке');
      }
    });

    // Help command
    this.bot.command(['help'], (ctx) => {
      console.log('Получена команда /help');
      return ctx.reply(this.getHelpMessage());
    });

    // Collage command - starts interactive collage creation
    this.bot.command(['collage', 'c'], (ctx) => {
      console.log('Получена команда /collage /c:', ctx.message?.text);
      return this.collageCommands.startConversation(ctx);
    });

    // Обработчик для текстовых сообщений в личных чатах и группах
    this.bot.on(message('text'), async (ctx) => {
      console.log('Получено текстовое сообщение:', ctx.message.text);

      if (this.qaCommands.isActive(ctx.chat.id)) {
        await this.qaCommands.handleText(ctx);
        return;
      }

      if (ctx.scene?.session?.current === 'taskEditScene') {
        return;
      }

      if (!ctx.message.text.startsWith('/')) {
        const isGroup =
          ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
        await this.handleIncomingMessage(ctx.chat.id, ctx.update, isGroup);
      }
    });

    // Обработчик для фото в личных чатах и группах
    this.bot.on(message('photo'), async (ctx) => {
      console.log('Получено фото из чата/группы');

      if (ctx.scene?.session?.current === 'taskEditScene') {
        return;
      }

      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      await this.handleIncomingPhoto(ctx, isGroup);
    });

    // Обработчик фото из каналов
    this.bot.on(channelPost('photo'), async (ctx) => {
      console.log('Получено фото из канала');

      if (!ctx.channelPost) return;

      const photoContext = {
        ...ctx,
        message: ctx.channelPost,
        chat: ctx.chat,
        updateType: 'message',
        me: ctx.botInfo,
        tg: ctx.telegram,
        editedMessage: undefined,
        state: {},
      } as unknown as Context;

      await this.handleIncomingPhoto(photoContext, true);
    });

    // Обработчик для видео в личных чатах и группах
    this.bot.on(message('video'), async (ctx) => {
      console.log('Получено видео из чата/группы');

      if (ctx.scene?.session?.current === 'taskEditScene') {
        return;
      }

      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      await this.handleIncomingVideo(ctx, isGroup);
    });

    // Обработчик видео из каналов
    this.bot.on(channelPost('video'), async (ctx) => {
      console.log('Получено видео из канала');

      if (!ctx.channelPost) return;

      const videoContext = {
        ...ctx,
        message: ctx.channelPost,
        chat: ctx.chat,
        updateType: 'message',
        me: ctx.botInfo,
        tg: ctx.telegram,
        editedMessage: undefined,
        state: {},
      } as unknown as Context;

      await this.handleIncomingVideo(videoContext, true);
    });

    // Handle inline buttons
    this.bot.on('callback_query', async (ctx) => {
      const data = (ctx.callbackQuery as CallbackQuery.DataQuery | undefined)
        ?.data;
      if (data === 'collage_cancel') {
        await this.collageCommands.cancel(ctx);
      } else if (data === 'collage_generate') {
        await this.collageCommands.generate(ctx);
      } else if (data === 'collage_generate_special') {
        await this.collageCommands.generateSpecial(ctx);
      } else if (data === 'collage_generate_special2') {
        await this.collageCommands.askCircleSize(ctx);
      } else if (
        data === 'circle_size_50' ||
        data === 'circle_size_60' ||
        data === 'circle_size_70' ||
        data === 'circle_size_80' ||
        data === 'circle_size_90'
      ) {
        const percent = parseInt(data.replace('circle_size_', ''), 10);
        await this.collageCommands.generateSpecial2(ctx, percent);
      } else if (
        data === 'qa_type_string' ||
        data === 'qa_type_number' ||
        data === 'qa_type_boolean'
      ) {
        await this.qaCommands.handleTypeSelection(ctx);
      } else if (data === 'q_yes' || data === 'q_no' || data === 'q_skip') {
        await this.qaCommands.handleAnswerCallback(ctx);
      } else if (data && data.startsWith('edit_task_')) {
        const key = data.replace('edit_task_', '');
        await ctx.scene.enter('taskEditScene', { key });
      }
    });
  }

  async handleIncomingMessage(
    chatId: number,
    update: TelegramUpdate,
    silent = false,
  ) {
    try {
      const messageText = this.extractMessageText(update);
      const { date: noteDate, cleanContent } =
        this.dateParser.extractDateFromFirstLine(messageText);

      // Получаем ID отправителя или создателя канала
      let fromUserId: number | undefined = this.extractSenderId(update);

      // Если это канал и нет ID отправителя, получаем создателя канала
      if ('channel_post' in update && !fromUserId) {
        console.log(
          'DEBUG: No fromUserId found, trying to get channel creator',
        );
        const creatorId = await this.getChannelCreatorId(chatId);
        if (creatorId) {
          fromUserId = creatorId;
          console.log('Найден создатель канала:', fromUserId);
        } else {
          console.log('DEBUG: Could not find channel creator');
        }
      }

      // Сохраняем сообщение в чат/группу/канал
      const savedNote = await this.prisma.note.create({
        data: {
          content: cleanContent,
          rawMessage: JSON.parse(
            JSON.stringify(update),
          ) as unknown as Prisma.InputJsonValue,
          chatId,
          noteDate: noteDate || new Date(),
        },
      });

      if (!silent) {
        // Формируем и отправляем ответ бота только для личных чатов
        const botResponse = `Сообщение сохранено${noteDate ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}` : ''}`;
        await this.bot.telegram.sendMessage(chatId, botResponse);

        await this.prisma.botResponse.create({
          data: {
            content: botResponse,
            noteId: savedNote.id,
            chatId,
          },
        });
      }

      // Если это канал и есть ID создателя, сохраняем копию в его личный чат
      if ('channel_post' in update && fromUserId && chatId !== fromUserId) {
        console.log('Сохраняем копию создателю канала:', fromUserId);
        await this.prisma.note.create({
          data: {
            content: cleanContent,
            rawMessage: JSON.parse(
              JSON.stringify(update),
            ) as unknown as Prisma.InputJsonValue,
            chatId: fromUserId,
            noteDate: noteDate || new Date(),
          },
        });
      } else if ('channel_post' in update) {
        console.log(
          'DEBUG: Channel post detected but not copying. fromUserId:',
          fromUserId,
          'chatId:',
          chatId,
        );
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }

  private extractMessageText(update: TelegramUpdate): string {
    if ('message' in update && update.message && 'text' in update.message) {
      return update.message.text || '';
    }
    if (
      'callback_query' in update &&
      update.callback_query.message &&
      'text' in update.callback_query.message
    ) {
      return update.callback_query.message.text || '';
    }
    if (
      'channel_post' in update &&
      update.channel_post &&
      'text' in update.channel_post
    ) {
      return update.channel_post.text || '';
    }
    return '';
  }

  public async handleIncomingPhoto(ctx: Context, silent = false) {
    try {
      if (!ctx.message) return;

      const photos = 'photo' in ctx.message ? ctx.message.photo : null;
      const caption = 'caption' in ctx.message ? ctx.message.caption : '';

      if (!photos || photos.length === 0 || !ctx.chat) return;

      // Check if interactive collage session is active
      if (this.collageCommands.isActive(ctx.chat.id)) {
        await this.collageCommands.addImage(ctx);
        return;
      }

      // Check if this is a collage command via caption
      if (
        caption &&
        (caption.toLowerCase().includes('/collage') ||
          caption.toLowerCase().includes('/c'))
      ) {
        console.log('Collage command detected in photo caption');
        await this.collageCommands.handleCollageCommand(ctx);
        return; // Exit early to prevent saving individual images
      }

      // Process all photos for database saving (original behavior)
      const photo = photos[photos.length - 1]; // Use the highest quality photo
      const file = await ctx.telegram.getFile(photo.file_id);
      const photoBuffer = await this.downloadFile(file.file_path!);
      const photoUrl = await this.storageService.uploadFile(
        photoBuffer,
        'image/jpeg',
        ctx.chat.id,
      );

      // Get image description from LLM
      const imageDescription = await this.llmService.describeImage(
        photoBuffer,
        caption,
      );

      const { date: noteDate, cleanContent } =
        this.dateParser.extractDateFromFirstLine(caption || '');

      // Получаем ID отправителя или создателя канала
      let fromUserId: number | undefined = ctx.message.from?.id;

      // Если это канал и нет ID отправителя, получаем создателя канала
      if (ctx.chat.type === 'channel' && !fromUserId) {
        const creatorId = await this.getChannelCreatorId(ctx.chat.id);
        if (creatorId) {
          fromUserId = creatorId;
          console.log('Найден создатель канала:', fromUserId);
        } else {
          console.log('DEBUG: Could not find channel creator for photo');
        }
      }

      // Сохраняем фото в чат/группу/канал
      const savedNote = await this.prisma.note.create({
        data: {
          content: cleanContent || '',
          rawMessage: JSON.parse(
            JSON.stringify(ctx.message),
          ) as unknown as Prisma.InputJsonValue,
          chatId: ctx.chat.id,
          noteDate: noteDate || new Date(),
          images: {
            create: {
              url: photoUrl,
              description: imageDescription,
            },
          },
        },
        include: {
          images: true,
        },
      });

      if (!silent) {
        const botResponse = `Фотография сохранена${
          noteDate
            ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}`
            : ''
        }\n\nОписание: ${imageDescription}`;
        await ctx.reply(botResponse);

        await this.prisma.botResponse.create({
          data: {
            content: botResponse,
            noteId: savedNote.id,
            chatId: ctx.chat.id,
          },
        });
      }

      // Если это канал и есть ID создателя, сохраняем копию фото в его личный чат
      if (
        ctx.chat.type === 'channel' &&
        fromUserId &&
        ctx.chat.id !== fromUserId
      ) {
        console.log('Сохраняем копию фото создателю канала:', fromUserId);
        await this.prisma.note.create({
          data: {
            content: cleanContent || '',
            rawMessage: JSON.parse(
              JSON.stringify(ctx.message),
            ) as unknown as Prisma.InputJsonValue,
            chatId: fromUserId,
            noteDate: noteDate || new Date(),
            images: {
              create: {
                url: photoUrl,
                description: imageDescription,
              },
            },
          },
        });
      }
    } catch (error) {
      console.error('Error processing photo:', error);
      if (!silent) {
        await ctx.reply('Произошла ошибка при сохранении фотографии');
      }
    }
  }

  public async handleIncomingVideo(ctx: Context, silent = false) {
    try {
      if (!ctx.message) return;

      const video = 'video' in ctx.message ? ctx.message.video : null;
      const caption = 'caption' in ctx.message ? ctx.message.caption : '';

      if (!video || !ctx.chat) return;

      // Pre-check size to avoid Telegram "file is too big" errors on getFile
      const fileSize =
        typeof video.file_size === 'number' ? video.file_size : 0;
      if (fileSize > MAX_TELEGRAM_FILE_DOWNLOAD_BYTES) {
        console.warn(
          `Video too large to download via Telegram getFile: ${fileSize} bytes > ${MAX_TELEGRAM_FILE_DOWNLOAD_BYTES}`,
        );

        const { date: tooBigNoteDate, cleanContent: tooBigCleanContent } =
          this.dateParser.extractDateFromFirstLine(caption || '');

        // Save only the text/caption and raw message without video
        const savedNoteTooBig = await this.prisma.note.create({
          data: {
            content: tooBigCleanContent || '',
            rawMessage: JSON.parse(
              JSON.stringify(ctx.message),
            ) as unknown as Prisma.InputJsonValue,
            chatId: ctx.chat.id,
            noteDate: tooBigNoteDate || new Date(),
          },
        });

        if (!silent) {
          const mb = (fileSize / (1024 * 1024)).toFixed(1);
          await ctx.reply(
            `Видео не сохранено: файл слишком большой для скачивания ботом (${mb} MB). Ограничение Telegram ≈ 20 MB. Сократите/сожмите видео или пришлите ссылку. Описание заметки сохранено${
              tooBigNoteDate
                ? ` с датой ${format(tooBigNoteDate, 'd MMMM yyyy', { locale: ru })}`
                : ''
            }`,
          );

          await this.prisma.botResponse.create({
            data: {
              content: `Видео не сохранено: превышен лимит Telegram на скачивание файлов ботом.`,
              noteId: savedNoteTooBig.id,
              chatId: ctx.chat.id,
            },
          });
        }

        // If this is a channel post, also save a copy for the creator (text only)
        let channelCreatorId: number | undefined = ctx.message.from?.id;
        if (ctx.chat.type === 'channel' && !channelCreatorId) {
          channelCreatorId = await this.getChannelCreatorId(ctx.chat.id);
        }
        if (
          ctx.chat.type === 'channel' &&
          channelCreatorId &&
          ctx.chat.id !== channelCreatorId
        ) {
          await this.prisma.note.create({
            data: {
              content: savedNoteTooBig.content,
              rawMessage: JSON.parse(
                JSON.stringify(ctx.message),
              ) as unknown as Prisma.InputJsonValue,
              chatId: channelCreatorId,
              noteDate: savedNoteTooBig.noteDate,
            },
          });
        }

        return; // Stop further processing for oversized videos
      }

      // Normal flow for acceptable sizes
      const file = await ctx.telegram.getFile(video.file_id);
      const videoBuffer = await this.downloadFile(file.file_path!);
      const videoUrl = await this.storageService.uploadVideo(
        videoBuffer,
        video.mime_type || 'video/mp4',
        ctx.chat.id,
      );

      const { date: noteDate, cleanContent } =
        this.dateParser.extractDateFromFirstLine(caption || '');

      let fromUserId: number | undefined = ctx.message.from?.id;

      if (ctx.chat.type === 'channel' && !fromUserId) {
        const creatorId = await this.getChannelCreatorId(ctx.chat.id);
        if (creatorId) {
          fromUserId = creatorId;
          console.log('Найден создатель канала:', fromUserId);
        } else {
          console.log('DEBUG: Could not find channel creator for video');
        }
      }

      const savedNote = await this.prisma.note.create({
        data: {
          content: cleanContent || '',
          rawMessage: JSON.parse(
            JSON.stringify(ctx.message),
          ) as unknown as Prisma.InputJsonValue,
          chatId: ctx.chat.id,
          noteDate: noteDate || new Date(),
          videos: {
            create: {
              url: videoUrl,
              description: caption || null,
            },
          },
        },
        include: {
          videos: true,
        },
      });

      if (!silent) {
        const botResponse = `Видео сохранено${
          noteDate
            ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}`
            : ''
        }`;
        await ctx.reply(botResponse);

        await this.prisma.botResponse.create({
          data: {
            content: botResponse,
            noteId: savedNote.id,
            chatId: ctx.chat.id,
          },
        });
      }

      if (
        ctx.chat.type === 'channel' &&
        fromUserId &&
        ctx.chat.id !== fromUserId
      ) {
        console.log('Сохраняем копию видео создателю канала:', fromUserId);
        await this.prisma.note.create({
          data: {
            content: cleanContent || '',
            rawMessage: JSON.parse(
              JSON.stringify(ctx.message),
            ) as unknown as Prisma.InputJsonValue,
            chatId: fromUserId,
            noteDate: noteDate || new Date(),
            videos: {
              create: {
                url: videoUrl,
                description: caption || null,
              },
            },
          },
        });
      }
    } catch (error) {
      // Gracefully handle Telegram "file is too big" error if it occurs despite checks
      const maybeTelegramError = error as unknown as {
        response?: { description?: string };
      };
      if (
        maybeTelegramError?.response?.description &&
        maybeTelegramError.response.description
          .toLowerCase()
          .includes('file is too big')
      ) {
        if (!silent) {
          await ctx.reply(
            'Видео не сохранено: файл слишком большой для скачивания ботом (лимит Telegram ≈ 20 MB). Сократите/сожмите видео или пришлите прямую ссылку и используйте команду /v <url> [описание] для сохранения.',
          );
        }
        return;
      }
      console.error('Error processing video:', error);
      if (!silent) {
        await ctx.reply('Произошла ошибка при сохранении видео');
      }
    }
  }

  private async handleVideoByUrl(
    ctx: Context,
    url: string,
    caption: string,
  ): Promise<void> {
    if (!ctx.chat) return;
    const { stream, mimeType } = await this.createStreamFromUrl(url);

    const uploadedUrl = await this.storageService.uploadVideoStream(
      stream,
      mimeType,
      ctx.chat.id,
    );

    const { date: noteDate, cleanContent } =
      this.dateParser.extractDateFromFirstLine(caption || '');

    const savedNote = await this.prisma.note.create({
      data: {
        content: cleanContent || '',
        rawMessage: JSON.parse(
          JSON.stringify({ url, caption }),
        ) as unknown as Prisma.InputJsonValue,
        chatId: ctx.chat.id,
        noteDate: noteDate || new Date(),
        videos: {
          create: {
            url: uploadedUrl,
            description: caption || null,
          },
        },
      },
      include: { videos: true },
    });

    await ctx.reply(
      `Видео сохранено по ссылке${
        noteDate
          ? ` с датой ${format(noteDate, 'd MMMM yyyy', { locale: ru })}`
          : ''
      }`,
    );

    await this.prisma.botResponse.create({
      data: {
        content: 'Видео сохранено по ссылке',
        noteId: savedNote.id,
        chatId: ctx.chat.id,
      },
    });

    // If post came from a channel, save a copy to creator as well (text + video)
    let fromUserId: number | undefined =
      ctx.message && 'from' in ctx.message ? ctx.message.from?.id : undefined;
    if (ctx.chat.type === 'channel' && !fromUserId) {
      fromUserId = await this.getChannelCreatorId(ctx.chat.id);
    }
    if (
      ctx.chat.type === 'channel' &&
      fromUserId &&
      ctx.chat.id !== fromUserId
    ) {
      await this.prisma.note.create({
        data: {
          content: cleanContent || '',
          rawMessage: JSON.parse(
            JSON.stringify({ url, caption }),
          ) as unknown as Prisma.InputJsonValue,
          chatId: fromUserId,
          noteDate: noteDate || new Date(),
          videos: {
            create: {
              url: uploadedUrl,
              description: caption || null,
            },
          },
        },
      });
    }
  }

  private async createStreamFromUrl(
    url: string,
  ): Promise<{ stream: Readable; mimeType: string }> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch video: ${response.status} ${response.statusText}`,
      );
    }
    const contentType = response.headers.get('content-type') || 'video/mp4';

    // Convert Web ReadableStream to Node.js Readable without using any type assertions
    async function* chunkGenerator(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      try {
         
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            yield Buffer.from(value);
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    // response.body is a Web ReadableStream<Uint8Array> in Node 18+
    const webStream = response.body as unknown as ReadableStream<Uint8Array>;
    const nodeReadable = Readable.from(chunkGenerator(webStream));
    return { stream: nodeReadable, mimeType: contentType };
  }

  private async downloadFile(filePath: string): Promise<Buffer> {
    const response = await fetch(
      `https://api.telegram.org/file/bot${this.configService.get('TELEGRAM_BOT_TOKEN')}/${filePath}`,
    );
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private extractSenderId(update: TelegramUpdate): number | undefined {
    if ('message' in update && update.message?.from) {
      return update.message.from.id;
    }
    if ('callback_query' in update && update.callback_query?.from) {
      return update.callback_query.from.id;
    }
    if ('channel_post' in update && update.channel_post?.from) {
      console.log(
        'DEBUG: Found from field in channel_post:',
        update.channel_post.from,
      );
      return update.channel_post.from.id;
    }
    if ('channel_post' in update) {
      console.log(
        'DEBUG: Channel post has no from field:',
        update.channel_post,
      );
    }
    return undefined;
  }

  private async getChannelCreatorId(
    chatId: number,
  ): Promise<number | undefined> {
    // Сначала проверяем маппинг
    if (this.channelCreatorMapping.has(chatId)) {
      const creatorId = this.channelCreatorMapping.get(chatId);
      console.log('DEBUG: Found creator in mapping:', creatorId);
      return creatorId;
    }

    // Если нет в маппинге, пытаемся получить через API
    try {
      const admins = await this.bot.telegram.getChatAdministrators(chatId);
      const creator = admins.find((admin) => admin.status === 'creator');
      if (creator) {
        const creatorId = creator.user.id;
        // Сохраняем в маппинг для будущего использования
        this.channelCreatorMapping.set(chatId, creatorId);
        console.log(
          'DEBUG: Found creator via API and saved to mapping:',
          creatorId,
        );
        return creatorId;
      }
    } catch (error) {
      console.error(
        'Ошибка при получении информации о создателе канала:',
        error,
      );
    }

    return undefined;
  }

  private getHelpMessage(): string {
    const commands = [
      { name: '/d or /dairy', description: 'Dairy Notes' },
      { name: '/history', description: 'Chat History' },
      { name: '/s', description: 'Serbian Translation' },
      { name: '/f', description: 'Translate between RU/EN/SR' },
      { name: '/t or /task', description: 'Create Todo item' },
      { name: '/tl', description: 'List Todo items' },
      { name: '/th', description: 'Tasks HTML export' },
      { name: '/a', description: 'Open Mini App' },
      { name: '/qa', description: 'Add question' },
      { name: '/ql', description: 'List questions' },
      { name: '/qq', description: 'Questions and answers for a date' },
      { name: '/qh', description: 'Questions history HTML export' },
      { name: '/q', description: 'Answer questions' },
      { name: '/c or /collage', description: 'Create image collage' },
      { name: '/help', description: 'Show this help message' },
    ];
    commands.sort((a, b) => a.name.localeCompare(b.name));
    return commands.map((c) => `${c.name} - ${c.description}`).join('\n');
  }

  // Метод для добавления маппинга канала к создателю
  addChannelCreatorMapping(channelId: number, creatorId: number) {
    this.channelCreatorMapping.set(channelId, creatorId);
    console.log(`Added channel mapping: ${channelId} -> ${creatorId}`);
  }

  // Добавляем метод для обработки webhook-обновлений
  async handleWebhook(update: Update) {
    return this.bot.handleUpdate(update);
  }
}
