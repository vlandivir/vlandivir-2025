import { Module } from '@nestjs/common';
import { DateParserService } from './date-parser.service';
import { StorageService } from './storage.service';
import { LlmService } from './llm.service';
import { PdfService } from './pdf.service';
import { DebugLogService } from './debug-log.service';
import { InstagramMetaService } from './instagram-meta.service';
import { ReelsService } from './reels.service';
import { EmbeddingsService } from './embeddings.service';
import { DiarySearchService } from './diary-search.service';
import { ReelsQaService } from './reels-qa.service';
import { DiaryQaService } from './diary-qa.service';
import { EmailIngestService } from './email-ingest.service';

@Module({
  providers: [
    DateParserService,
    StorageService,
    LlmService,
    PdfService,
    DebugLogService,
    InstagramMetaService,
    ReelsService,
    EmbeddingsService,
    DiarySearchService,
    ReelsQaService,
    DiaryQaService,
    EmailIngestService,
  ],
  exports: [
    DateParserService,
    StorageService,
    LlmService,
    PdfService,
    DebugLogService,
    InstagramMetaService,
    ReelsService,
    EmbeddingsService,
    DiarySearchService,
    ReelsQaService,
    DiaryQaService,
    EmailIngestService,
  ],
})
export class ServicesModule {}
