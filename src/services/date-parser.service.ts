import { Injectable } from '@nestjs/common';
import { parse, isValid } from 'date-fns';
import { ru } from 'date-fns/locale';

@Injectable()
export class DateParserService {
    private dateFormats = [
        'yyyy.MM.dd',
        'd MMMM',
        'd MMM yyyy',
        'yyyy-MM-dd',
        'dd.MM',
        'MM/dd',
    ];

    extractDateFromFirstLine(text: string): Date | null {
        const firstLine = text.split('\n')[0].trim();
        
        // Пробуем разные форматы
        for (const format of this.dateFormats) {
            const parsedDate = parse(firstLine, format, new Date(), { locale: ru });
            if (isValid(parsedDate)) {
                // Если год не был указан в формате, используем текущий
                if (!format.includes('yyyy')) {
                    parsedDate.setFullYear(new Date().getFullYear());
                }
                return parsedDate;
            }
        }

        return null;
    }
} 