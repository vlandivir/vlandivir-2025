import { Test, TestingModule } from '@nestjs/testing';
import { DateParserService } from './date-parser.service';

describe('DateParserService', () => {
    let service: DateParserService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: DateParserService,
                    useClass: DateParserService,
                }
            ],
        }).compile();

        service = module.get(DateParserService);
    });

    it('should parse YYYY.MM.DD format', () => {
        const result = service.extractDateFromFirstLine('2024.02.15\nsome text');
        expect(result).toEqual(new Date(2024, 1, 15));
    });

    it('should parse day and month in Russian', () => {
        const result = service.extractDateFromFirstLine('2 января\nsome text');
        const currentYear = new Date().getFullYear();
        expect(result).toEqual(new Date(currentYear, 0, 2));
    });

    it('should parse date with English month and year', () => {
        const result = service.extractDateFromFirstLine('2 jan 2018\nsome text');
        expect(result).toEqual(new Date(2018, 0, 2));
    });

    it('should return null for invalid date', () => {
        const result = service.extractDateFromFirstLine('not a date\nsome text');
        expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
        const result = service.extractDateFromFirstLine('');
        expect(result).toBeNull();
    });
}); 