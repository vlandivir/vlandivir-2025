import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DebugLogService } from './debug-log.service';

/** OpenAI assistant message.content may be a string or an array of text/refusal parts. */
function extractTextFromAssistantContent(content: unknown): {
  text: string | null;
  refusals: string[];
} {
  const refusals: string[] = [];
  if (content === null || content === undefined) {
    return { text: null, refusals };
  }
  if (typeof content === 'string') {
    const t = content.trim();
    return { text: t.length > 0 ? t : null, refusals };
  }
  if (!Array.isArray(content)) {
    return { text: null, refusals };
  }
  const texts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { type?: string; text?: string; refusal?: string };
    if (p.type === 'text' && typeof p.text === 'string') {
      texts.push(p.text);
    } else if (p.type === 'refusal' && typeof p.refusal === 'string') {
      refusals.push(p.refusal);
    }
  }
  const joined = texts.join('').trim();
  return { text: joined.length > 0 ? joined : null, refusals };
}

const IMAGE_DESCRIPTION_MAX_COMPLETION_TOKENS = 1600;
const TEXT_REFINE_MAX_COMPLETION_TOKENS = 1600;

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface DescribeImageOptions {
  // Emphasise careful transcription of handwritten text (e.g. diary pages).
  handwriting?: boolean;
  // Higher effort recognises messy handwriting better, at the cost of latency.
  reasoningEffort?: ReasoningEffort;
}

@Injectable()
export class LlmService {
  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly debugLogService?: DebugLogService,
  ) {}

  async describeImage(
    imageBuffer: Buffer,
    comment?: string,
    noteContext?: string,
    options?: DescribeImageOptions,
  ): Promise<string> {
    const handwriting = options?.handwriting ?? false;
    const reasoningEffort: ReasoningEffort =
      options?.reasoningEffort ?? 'minimal';
    try {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not defined');
      }

      this.debugLogService?.info(
        'llm.describeImage',
        'Starting image description',
        {
          imageBytes: imageBuffer.length,
          hasComment: Boolean(comment && comment.trim()),
        },
      );

      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');

      // Create timeout signal with fallback for older Node.js versions
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutSignal =
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(30000)
          : (() => {
              const controller = new AbortController();
              timeoutId = setTimeout(() => controller.abort(), 30000);
              return controller.signal;
            })();

      try {
        const response = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-5',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: [
                        'Опиши это изображение на русском языке — точно и подробно, так чтобы по описанию его можно было найти текстовым поиском.',
                        handwriting
                          ? 'На изображении, скорее всего, рукописный текст (например, страница дневника). Твоя главная задача — как можно точнее расшифровать этот текст.'
                          : null,
                        handwriting
                          ? 'Внимательно, строка за строкой, разбери рукописный текст дословно, сохраняя порядок строк и абзацы. Учитывай особенности почерка и контекст соседних слов, чтобы правильно прочитать неразборчивые буквы.'
                          : null,
                        handwriting
                          ? 'Если слово прочитать уверенно не удаётся, приведи наиболее вероятный вариант и пометь его вопросительным знаком в скобках, например: слово(?).'
                          : null,
                        handwriting
                          ? 'Сначала выпиши полную расшифровку рукописного текста, затем отдельным абзацем кратко опиши, что ещё видно на изображении (обстановку, рисунки, схемы).'
                          : 'Сначала один абзац: что происходит, кто и что видно, обстановка, место, сезон и время суток, если их можно определить.',
                        handwriting
                          ? null
                          : 'Затем выпиши дословно весь видимый текст (вывески, этикетки, меню, экраны, документы) на языке оригинала.',
                        'Назови конкретные объекты, бренды, названия мест и блюд, породы животных и виды растений, если уверенно их узнаёшь.',
                        'Не используй слова "фотография" или "изображение" и вводных конструкций, сразу описывай что видишь.',
                        'Не выдумывай деталей, которых не видно, и не делай обобщений о настроении.',
                        comment ? `Комментарий пользователя: ${comment}` : null,
                        noteContext
                          ? `Текст заметки, к которой приложено изображение (используй как контекст, но описывай то, что видно): ${noteContext}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' '),
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:image/jpeg;base64,${base64Image}`,
                      },
                    },
                  ],
                },
              ],
              max_completion_tokens: IMAGE_DESCRIPTION_MAX_COMPLETION_TOKENS,
              reasoning_effort: reasoningEffort,
            }),
            signal: timeoutSignal,
          },
        );

        // Clear timeout if request completes successfully
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          let errorBody: unknown;
          const raw = await response.text();
          try {
            errorBody = raw ? JSON.parse(raw) : null;
          } catch {
            errorBody = raw?.slice(0, 2000) ?? null;
          }
          console.error('OpenAI API error:', errorBody);
          this.debugLogService?.error(
            'llm.describeImage',
            'OpenAI HTTP error',
            {
              status: response.status,
              statusText: response.statusText,
              body: errorBody,
            },
          );
          throw new Error(
            `OpenAI API error: ${response.status} ${response.statusText}`,
          );
        }

        const data: unknown = await response.json();

        // Validate the response structure
        if (!data || typeof data !== 'object') {
          console.error('Invalid OpenAI response - not an object:', data);
          throw new Error('Invalid response format from OpenAI');
        }

        const responseData = data as {
          choices?: {
            message?: {
              content?: string;
            };
          }[];
          error?: unknown;
        };

        // Check for OpenAI API errors in the response body
        if (responseData.error) {
          console.error(
            'OpenAI API error in response body:',
            responseData.error,
          );
          this.debugLogService?.error(
            'llm.describeImage',
            'OpenAI error field in 200 body',
            { error: responseData.error },
          );
          throw new Error('OpenAI API returned an error');
        }

        // Add detailed logging to understand the response structure
        console.log('OpenAI API response:', JSON.stringify(data, null, 2));

        if (
          !responseData.choices ||
          !Array.isArray(responseData.choices) ||
          responseData.choices.length === 0
        ) {
          console.error(
            'Unexpected OpenAI response structure - no choices array or empty choices:',
            responseData,
          );
          this.debugLogService?.error(
            'llm.describeImage',
            'No choices in OpenAI response',
            {
              keys:
                data && typeof data === 'object'
                  ? Object.keys(data as object)
                  : [],
            },
          );
          throw new Error(
            'Invalid response structure from OpenAI - no choices available',
          );
        }

        const choice = responseData.choices[0] as {
          finish_reason?: string;
          message?: { content?: unknown };
        };
        if (!choice || !choice.message) {
          console.error('Unexpected choice structure:', choice);
          this.debugLogService?.error(
            'llm.describeImage',
            'Missing message on choice',
            {
              choiceKeys: choice ? Object.keys(choice) : [],
            },
          );
          throw new Error('Invalid choice structure from OpenAI');
        }

        const rawContent = choice.message.content;
        const { text: description, refusals } =
          extractTextFromAssistantContent(rawContent);

        this.debugLogService?.info(
          'llm.describeImage',
          'Parsed assistant content',
          {
            finishReason: choice.finish_reason,
            contentKind: Array.isArray(rawContent)
              ? 'array'
              : rawContent === null || rawContent === undefined
                ? 'null'
                : typeof rawContent,
            contentParts: Array.isArray(rawContent)
              ? rawContent.length
              : undefined,
            refusalCount: refusals.length,
            hasText: Boolean(description && description.length > 0),
          },
        );

        if (refusals.length > 0 && !description) {
          console.error('OpenAI refusal (no text):', refusals);
          this.debugLogService?.warn(
            'llm.describeImage',
            'Model refusal only',
            {
              refusals,
            },
          );
          throw new Error('OpenAI model refused to describe the image');
        }

        if (!description) {
          console.error('No valid description content received:', rawContent);
          this.debugLogService?.error(
            'llm.describeImage',
            'No extractable text from assistant content',
            {
              rawContentPreview:
                typeof rawContent === 'string'
                  ? rawContent.slice(0, 500)
                  : JSON.stringify(rawContent)?.slice(0, 1500),
            },
          );
          throw new Error('No description received from OpenAI');
        }

        // Additional validation - check if the description is meaningful
        if (description.trim().length === 0) {
          console.error('Empty description received from OpenAI');
          throw new Error('Empty description received from OpenAI');
        }

        console.log(
          'Successfully received description:',
          description.substring(0, 100) + '...',
        );

        this.debugLogService?.info('llm.describeImage', 'Description OK', {
          previewLen: Math.min(description.length, 120),
        });

        return description.trim();
      } catch (error) {
        // Clear timeout if there's an error
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        console.error('Error describing image:', error);

        // Handle specific error types
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            return 'Превышено время ожидания ответа от OpenAI';
          }
          if (error.message.includes('OPENAI_API_KEY')) {
            return 'Ошибка конфигурации API ключа';
          }
          if (error.message.includes('OpenAI API error')) {
            return 'Ошибка API OpenAI';
          }
          if (error.message.includes('Invalid response structure')) {
            return 'Неожиданный формат ответа от OpenAI';
          }
          if (error.message.includes('No description received')) {
            return 'Не удалось получить описание от OpenAI';
          }
          if (error.message.includes('OpenAI model refused')) {
            return 'Модель отказалась описать изображение';
          }
          if (error.message.includes('Failed to parse')) {
            return 'Ошибка при обработке ответа от OpenAI';
          }
        }

        return 'Не удалось описать изображение';
      }
    } catch (error) {
      console.error('Error describing image (outer):', error);
      if (error instanceof Error) {
        if (error.message.includes('OPENAI_API_KEY')) {
          return 'Ошибка конфигурации API ключа';
        }
      }
      return 'Не удалось описать изображение';
    }
  }

  // Post-processing for a recognised (handwritten) transcription: fixes likely
  // misreadings using linguistic context, normalises spacing/punctuation and
  // keeps the original language. Returns the cleaned text, or the input
  // unchanged if the model is unavailable or errors out.
  async refineHandwrittenText(
    rawText: string,
    noteContext?: string,
  ): Promise<string> {
    const input = (rawText || '').trim();
    if (!input) return input;

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) return input;

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutSignal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(30000)
        : (() => {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 30000);
            return controller.signal;
          })();

    try {
      const instructions = [
        'Ниже — черновая расшифровка рукописного текста, полученная распознаванием. В ней могут быть ошибки: перепутанные буквы, неправильно прочитанные слова, лишние пометки вида слово(?).',
        'Аккуратно исправь очевидные ошибки распознавания, опираясь на смысл и контекст, восстанови естественные слова, пунктуацию и разбивку на абзацы.',
        'Сохрани исходный язык и смысл. Не добавляй ничего от себя и не убирай содержание. Если фрагмент действительно непонятен, оставь его как есть.',
        'Верни только исправленный текст, без пояснений и заголовков.',
        noteContext ? `Контекст заметки: ${noteContext}` : null,
      ]
        .filter(Boolean)
        .join(' ');

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-5',
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: input },
            ],
            max_completion_tokens: TEXT_REFINE_MAX_COMPLETION_TOKENS,
            reasoning_effort: 'low',
          }),
          signal: timeoutSignal,
        },
      );
      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        this.debugLogService?.warn(
          'llm.refineHandwrittenText',
          'OpenAI HTTP error',
          { status: response.status },
        );
        return input;
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const { text } = extractTextFromAssistantContent(
        data?.choices?.[0]?.message?.content,
      );
      return text && text.trim().length > 0 ? text.trim() : input;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      this.debugLogService?.warn('llm.refineHandwrittenText', 'Refine failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return input;
    }
  }
}
