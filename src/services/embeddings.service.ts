import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export type EmbeddingKind = 'reel' | 'note' | 'image';

// text-embedding-3-small supports up to 8191 tokens; keep a safe char margin
const MAX_INPUT_CHARS = 24000;
const EMBEDDINGS_TIMEOUT_MS = 30 * 1000;

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private get model(): string {
    return (
      this.configService.get<string>('EMBEDDING_MODEL') ||
      'text-embedding-3-small'
    );
  }

  async embedText(text: string): Promise<number[]> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, MAX_INPUT_CHARS),
      }),
      signal: AbortSignal.timeout(EMBEDDINGS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Embeddings API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: { embedding?: number[] }[];
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding?.length) {
      throw new Error('Embeddings API returned no embedding');
    }
    return embedding;
  }

  async upsert(
    kind: EmbeddingKind,
    refId: number,
    content: string,
    chatId?: bigint | null,
  ): Promise<void> {
    const embedding = await this.embedText(content);
    const vector = `[${embedding.join(',')}]`;
    await this.prisma.$executeRaw`
      INSERT INTO "Embedding" ("kind", "refId", "chatId", "content", "embedding", "updatedAt")
      VALUES (${kind}, ${refId}, ${chatId ?? null}, ${content}, ${vector}::vector, NOW())
      ON CONFLICT ("kind", "refId") DO UPDATE SET
        "content" = EXCLUDED."content",
        "embedding" = EXCLUDED."embedding",
        "chatId" = EXCLUDED."chatId",
        "updatedAt" = NOW()
    `;
  }

  async remove(kind: EmbeddingKind, refId: number): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "Embedding" WHERE "kind" = ${kind} AND "refId" = ${refId}
    `;
  }

  /**
   * Cosine-similarity search within one kind. Returns refIds with a
   * similarity in [0..1], best first. chatId narrows the scope for
   * private kinds (notes, images); for reels it is not used.
   */
  async search(
    kind: EmbeddingKind,
    query: string,
    options: { limit?: number; minSimilarity?: number; chatId?: bigint } = {},
  ): Promise<{ refId: number; similarity: number }[]> {
    const { limit = 12, minSimilarity = 0.3, chatId } = options;
    const embedding = await this.embedText(query);
    const vector = `[${embedding.join(',')}]`;
    const rows = await this.prisma.$queryRaw<
      { refId: number; similarity: number }[]
    >`
      SELECT "refId", 1 - ("embedding" <=> ${vector}::vector) AS "similarity"
      FROM "Embedding"
      WHERE "kind" = ${kind}
        AND (${chatId ?? null}::bigint IS NULL OR "chatId" = ${chatId ?? null}::bigint)
        AND 1 - ("embedding" <=> ${vector}::vector) >= ${minSimilarity}
      ORDER BY "embedding" <=> ${vector}::vector
      LIMIT ${limit}
    `;
    return rows;
  }
}
