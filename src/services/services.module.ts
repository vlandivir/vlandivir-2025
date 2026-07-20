import { Module } from '@nestjs/common';
import { DateParserService } from './date-parser.service';
import { StorageService } from './storage.service';
import { LlmService } from './llm.service';
import { PdfService } from './pdf.service';
import { DebugLogService } from './debug-log.service';
import { InstagramMetaService } from './instagram-meta.service';
import { ReelsService } from './reels.service';
import { EmbeddingsService } from './embeddings.service';
import { MapSearchService } from './map-search.service';
import { DiarySearchService } from './diary-search.service';
import { ReelsQaService } from './reels-qa.service';
import { DiaryQaService } from './diary-qa.service';
import { EmailIngestService } from './email-ingest.service';
import { EmailExecutorService } from './email-executor.service';
import { EmailClassifierService } from './email-classifier.service';

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
    MapSearchService,
    DiarySearchService,
    ReelsQaService,
    DiaryQaService,
    EmailIngestService,
    EmailExecutorService,
    EmailClassifierService,
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
    MapSearchService,
    DiarySearchService,
    ReelsQaService,
    DiaryQaService,
    EmailIngestService,
    EmailExecutorService,
    EmailClassifierService,
  ],
})
export class ServicesModule {}
