import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

describe('LlmService', () => {
  let service: LlmService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OPENAI_API_KEY') {
                return 'test-api-key';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('describeImage', () => {
    it('should return error message when API key is not defined', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);

      const result = await service.describeImage(Buffer.from('test'));
      expect(result).toBe('Ошибка конфигурации API ключа');
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () =>
          Promise.resolve(JSON.stringify({ error: 'Invalid API key' })),
      });

      const result = await service.describeImage(Buffer.from('test'));
      expect(result).toBe('Ошибка API OpenAI');
    });

    it('should accept assistant content as array of text parts (newer models)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: [{ type: 'text', text: '  Краткое описание  ' }],
                },
              },
            ],
          }),
      });

      const result = await service.describeImage(Buffer.from('test'));
      expect(result).toBe('Краткое описание');
    });

    it('should use enough completion budget for reasoning image models', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: 'Краткое описание',
                },
              },
            ],
          }),
      });

      await service.describeImage(Buffer.from('test'));

      const [, request] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(request.body);
      expect(body.max_completion_tokens).toBe(1600);
      expect(body.reasoning_effort).toBe('minimal');
    });
  });
});
