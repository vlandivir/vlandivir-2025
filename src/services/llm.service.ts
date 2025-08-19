import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  async describeImage(imageBuffer: Buffer, comment?: string): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not defined');
      }

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
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: [
                        'Опиши это изображение кратко и информативно на русском языке.',
                        'Опиши что видишь на изображении, включая объекты, людей, действия, и контекст.',
                        'Попробуй сделать описание, так чтобы его можно было использовать в журнальной статье.',
                        'Не используй слова "фотография" или "изображение" и вводных конструкций, сразу описывай что видишь.',
                        'Не делай обобщений о настроении или назначении изображения.',
                        comment ? `Комментарий пользователя: ${comment}` : null,
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
              max_completion_tokens: 400,
            }),
            signal: timeoutSignal,
          },
        );

        // Clear timeout if request completes successfully
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const errorData: unknown = await response.json();
          console.error('OpenAI API error:', errorData);
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
          throw new Error(
            'Invalid response structure from OpenAI - no choices available',
          );
        }

        const choice = responseData.choices[0];
        if (!choice || !choice.message) {
          console.error('Unexpected choice structure:', choice);
          throw new Error('Invalid choice structure from OpenAI');
        }

        const description = choice.message.content;

        if (!description || typeof description !== 'string') {
          console.error('No valid description content received:', description);
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
}
