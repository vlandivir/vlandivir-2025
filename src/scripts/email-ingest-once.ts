// One-off email ingest run for local testing:
//   npx ts-node src/scripts/email-ingest-once.ts
// Requires EMAIL_ACCOUNTS (and DO Spaces / Postgres credentials) in .env.
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';
import { EmailIngestService } from '../services/email-ingest.service';

async function main() {
  const configService = new ConfigService();
  const prisma = new PrismaService();
  const storage = new StorageService(configService);
  const ingest = new EmailIngestService(configService, prisma, storage);

  try {
    const results = await ingest.syncAll();
    if (results.length === 0) {
      console.log('Nothing to do (EMAIL_ACCOUNTS not configured?)');
      return;
    }
    for (const result of results) {
      const suffix = result.error ? ` — ERROR: ${result.error}` : '';
      console.log(
        `${result.account}: ${result.ingested} new, ${result.skipped} already known${suffix}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
