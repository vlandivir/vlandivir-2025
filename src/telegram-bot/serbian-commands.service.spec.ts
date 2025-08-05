import { Test, TestingModule } from '@nestjs/testing';
import { SerbianCommandsService } from './serbian-commands.service';
import { ConfigService } from '@nestjs/config';
import { Context } from 'telegraf';

describe('SerbianCommandsService', () => {
  let service: SerbianCommandsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerbianCommandsService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-key') },
        },
      ],
    }).compile();

    service = module.get<SerbianCommandsService>(SerbianCommandsService);
  });

  it('replies with plain text without parse_mode when translation has special characters', async () => {
    const mockReply = jest
      .fn()
      .mockImplementation((text: string, options?: unknown) => {
        if (options && (options as { parse_mode?: string }).parse_mode) {
          return Promise.reject(new Error('Markdown mode not allowed'));
        }
        return Promise.resolve(text);
      });

    const ctx = {
      chat: { type: 'private' },
      message: { text: '/ser test' },
      reply: mockReply,
    } as unknown as Context;

    const translation =
      'link: [example](https://example.com) with *bold* _italic_';

    jest.spyOn(service as any, 'getTranslation').mockResolvedValue(translation);

    await expect(service.handleSerbianCommand(ctx)).resolves.not.toThrow();

    expect(mockReply).toHaveBeenNthCalledWith(1, 'Получаю перевод...');
    expect(mockReply).toHaveBeenNthCalledWith(2, translation);

    const secondCall = mockReply.mock.calls[1];
    expect(secondCall[1]).toBeUndefined();
  });
});
