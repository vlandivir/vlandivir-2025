import { Scenes, Context } from 'telegraf';
import { CallbackQuery } from 'telegraf/typings/core/types/typegram';
import { TaskCommandsService } from '../task-commands.service';

export interface TaskEditWizardContext extends Context {
  scene: Scenes.SceneContextScene<
    TaskEditWizardContext,
    Scenes.WizardSessionData
  >;
  wizard: Scenes.WizardContextWizard<TaskEditWizardContext>;
}

export function createTaskEditScene(taskService: TaskCommandsService) {
  return new Scenes.WizardScene<TaskEditWizardContext>(
    'taskEditScene',
    async (ctx) => {
      const key = (ctx.scene.state as { key: string }).key;
      (ctx.wizard.state as { key?: string }).key = key;
      await ctx.answerCbQuery?.();
      await (
        ctx as TaskEditWizardContext & {
          editMessageReplyMarkup?: (markup: any) => Promise<void>;
        }
      ).editMessageReplyMarkup?.(undefined);
      const chatId = ctx.chat?.id;
      if (chatId) {
        const latest = await taskService.getLatestTask(key, chatId);
        const notes = await taskService.getTaskNotes(key, chatId);
        if (latest) {
          let text = `${latest.key} ${latest.content}`;
          if (latest.priority) text += ` (${latest.priority})`;
          if (latest.dueDate) text += `\nDue: ${latest.dueDate.toISOString()}`;
          if (latest.tags.length) text += `\nTags: ${latest.tags.join(', ')}`;
          if (latest.contexts.length)
            text += `\nContexts: ${latest.contexts.join(', ')}`;
          if (latest.projects.length)
            text += `\nProjects: ${latest.projects.join(', ')}`;
          await ctx.reply(text);
          for (const img of latest.images) {
            await ctx.replyWithDocument(img.url, {
              caption: img.description || undefined,
            });
          }
        }
        for (const note of notes) {
          await ctx.reply(note.content);
        }
      }
      await ctx.reply(`Choose action for ${key}`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Done', callback_data: 'status_done' },
              { text: 'Canceled', callback_data: 'status_canceled' },
              { text: 'Snooze', callback_data: 'status_snooze' },
            ],
            [
              { text: 'Edit', callback_data: 'action_edit' },
              { text: 'Note', callback_data: 'action_note' },
              { text: 'Image', callback_data: 'action_image' },
            ],
            [{ text: 'Cancel', callback_data: 'cancel' }],
          ],
        },
      });
      return ctx.wizard.next();
    },
    async (ctx) => {
      const data = (ctx.callbackQuery as CallbackQuery.DataQuery | undefined)
        ?.data;
      const key = (ctx.wizard.state as { key: string }).key;
      if (!data) return;
      if (data === 'cancel') {
        await ctx.answerCbQuery?.();
        await ctx.scene.leave();
        return;
      }
      if (data === 'status_done' || data === 'status_canceled') {
        await ctx.answerCbQuery?.();
        await taskService.editTask(ctx, key, {
          content: '',
          tags: [],
          contexts: [],
          projects: [],
          status: data === 'status_done' ? 'done' : 'canceled',
        });
        await ctx.scene.leave();
        return;
      }
      if (data === 'status_snooze') {
        await ctx.answerCbQuery?.();
        await ctx.reply('How many days to snooze?');
        return ctx.wizard.selectStep(2);
      }
      if (data === 'action_edit') {
        await ctx.answerCbQuery?.();
        const chatId = ctx.chat?.id;
        if (chatId) {
          const latest = await taskService.getLatestTask(key, chatId);
          if (latest) {
            let text = `${latest.key} ${latest.content}`;
            if (latest.priority) text += ` (${latest.priority})`;
            if (latest.dueDate)
              text += `\nDue: ${latest.dueDate.toISOString()}`;
            if (latest.tags.length) text += `\nTags: ${latest.tags.join(', ')}`;
            if (latest.contexts.length)
              text += `\nContexts: ${latest.contexts.join(', ')}`;
            if (latest.projects.length)
              text += `\nProjects: ${latest.projects.join(', ')}`;
            await ctx.reply(text, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Cancel', callback_data: 'cancel' }],
                ],
              },
            });
            return ctx.wizard.selectStep(3);
          }
        }
        await ctx.reply('Task not found');
        await ctx.scene.leave();
        return;
      }
      if (data === 'action_note') {
        await ctx.answerCbQuery?.();
        await ctx.reply('Waiting for a note', {
          reply_markup: {
            inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
          },
        });
        return ctx.wizard.selectStep(4);
      }
      if (data === 'action_image') {
        await ctx.answerCbQuery?.();
        await ctx.reply('Waiting for an image', {
          reply_markup: {
            inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
          },
        });
        return ctx.wizard.selectStep(5);
      }
    },
    async (ctx) => {
      if (
        ctx.callbackQuery &&
        (ctx.callbackQuery as CallbackQuery.DataQuery).data === 'cancel'
      ) {
        await ctx.answerCbQuery?.();
        await ctx.scene.leave();
        return;
      }
      if (!ctx.message || !('text' in ctx.message)) return;
      const days = parseInt(ctx.message.text.trim(), 10);
      if (Number.isNaN(days)) {
        await ctx.reply('Please provide number of days');
        return;
      }
      const key = (ctx.wizard.state as { key: string }).key;
      const snoozedUntil = new Date();
      snoozedUntil.setDate(snoozedUntil.getDate() + days);
      await taskService.editTask(ctx, key, {
        content: '',
        tags: [],
        contexts: [],
        projects: [],
        status: 'snoozed',
        snoozedUntil,
      });
      await ctx.scene.leave();
    },
    async (ctx) => {
      if (
        ctx.callbackQuery &&
        (ctx.callbackQuery as CallbackQuery.DataQuery).data === 'cancel'
      ) {
        await ctx.answerCbQuery?.();
        await ctx.scene.leave();
        return;
      }
      if (!ctx.message || !('text' in ctx.message)) return;
      const key = (ctx.wizard.state as { key: string }).key;
      const parsed = taskService.parseTask(ctx.message.text.trim());
      await taskService.editTask(ctx, key, parsed);
      await ctx.scene.leave();
    },
    async (ctx) => {
      if (
        ctx.callbackQuery &&
        (ctx.callbackQuery as CallbackQuery.DataQuery).data === 'cancel'
      ) {
        await ctx.answerCbQuery?.();
        await ctx.scene.leave();
        return;
      }
      if (!ctx.message || !('text' in ctx.message)) return;
      const key = (ctx.wizard.state as { key: string }).key;
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await ctx.reply('Error: Chat ID not available');
        await ctx.scene.leave();
        return;
      }
      await taskService.createTaskNote(key, ctx.message.text.trim(), chatId);
      await ctx.reply('Note added');
      await ctx.scene.leave();
    },
    async (ctx) => {
      if (
        ctx.callbackQuery &&
        (ctx.callbackQuery as CallbackQuery.DataQuery).data === 'cancel'
      ) {
        await ctx.answerCbQuery?.();
        await ctx.scene.leave();
        return;
      }
      if (!ctx.message || !('photo' in ctx.message)) return;
      const key = (ctx.wizard.state as { key: string }).key;
      const images = await taskService.processTaskImages(ctx);
      if (images.length > 0) {
        await taskService.editTask(
          ctx,
          key,
          { content: '', tags: [], contexts: [], projects: [] },
          images,
        );
      }
      await ctx.scene.leave();
    },
  );
}
