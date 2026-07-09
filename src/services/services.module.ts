import { Module } from '@nestjs/common';
import { DateParserService } from './date-parser.service';
import { StorageService } from './storage.service';
import { LlmService } from './llm.service';
import { PdfService } from './pdf.service';
import { DebugLogService } from './debug-log.service';
import { InstagramMetaService } from './instagram-meta.service';
import { ReelsService } from './reels.service';

@Module({
  providers: [
    DateParserService,
    StorageService,
    LlmService,
    PdfService,
    DebugLogService,
    InstagramMetaService,
    ReelsService,
  ],
  exports: [
    DateParserService,
    StorageService,
    LlmService,
    PdfService,
    DebugLogService,
    InstagramMetaService,
    ReelsService,
  ],
})
export class ServicesModule {}
