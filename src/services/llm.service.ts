import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  async describeImage(imageBuffer: Buffer): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not defined');
      }

      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');

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
                      'Не делай обобщений о настроении или назначении изображения',
                    ].join(' '),
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
            max_tokens: 400,
            temperature: 0.8,
          }),
        },
      );

      if (!response.ok) {
        const errorData: unknown = await response.json();
        console.error('OpenAI API error:', errorData);
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as unknown as {
        choices: {
          message: {
            content: string;
          };
        }[];
      };
      const description = data.choices[0]?.message?.content;

      if (!description) {
        throw new Error('No description received from OpenAI');
      }

      return description.trim();
    } catch (error) {
      console.error('Error describing image:', error);
      return 'Не удалось описать изображение';
    }
  }
}
