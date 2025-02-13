import { Test, TestingModule } from '@nestjs/testing';
import { DateParserService } from './date-parser.service';

describe('DateParserService', () => {
    let service: DateParserService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DateParserService],
        }).compile();

        service = module.get(DateParserService);
    });

    it('should parse YYYY.MM.DD format', () => {
        const result = service.extractDateFromFirstLine('2024.02.15\nsome text');
        expect(result?.getFullYear()).toBe(2024);
        expect(result?.getMonth()).toBe(1); // февраль = 1
        expect(result?.getDate()).toBe(15);
    });

    it('should parse day and month in Russian', () => {
        const result = service.extractDateFromFirstLine('2 января\nsome text');
        const currentYear = new Date().getFullYear();
        expect(result?.getDate()).toBe(2);
        expect(result?.getMonth()).toBe(0); // январь = 0
        expect(result?.getFullYear()).toBe(currentYear);
    });

    it('should parse date with English month and year', () => {
        const result = service.extractDateFromFirstLine('2 jan 2018\nsome text');
        expect(result?.getFullYear()).toBe(2018);
        expect(result?.getMonth()).toBe(0); // январь = 0
        expect(result?.getDate()).toBe(2);
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