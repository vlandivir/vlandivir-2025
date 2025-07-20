import { Module } from '@nestjs/common';
import { DateParserService } from './date-parser.service';
import { StorageService } from './storage.service';
import { LlmService } from './llm.service';

@Module({
  providers: [DateParserService, StorageService, LlmService],
  exports: [DateParserService, StorageService, LlmService],
})
export class ServicesModule {}
