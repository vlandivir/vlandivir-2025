import { Injectable } from '@nestjs/common';
import { parse, isValid, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface ParseResult {
    date: Date | null;
    cleanContent: string;
}

@Injectable()
export class DateParserService {
    private dateFormats = [
        { format: 'yyyy.MM.dd', locale: enUS },
        { format: 'd MMMM', locale: ru },
        { format: 'd MMM yyyy', locale: enUS },
        { format: 'yyyy-MM-dd', locale: enUS },
        { format: 'dd.MM', locale: enUS },
        { format: 'MM/dd', locale: enUS },
    ];

    extractDateFromFirstLine(text: string): ParseResult {
        if (!text) return { date: null, cleanContent: '' };
        
        const lines = text.split('\n');
        const firstLine = lines[0].trim();
        
        // Пробуем разные форматы
        for (const { format, locale } of this.dateFormats) {
            try {
                const parsedDate = parse(firstLine, format, new Date(), { locale });
                if (isValid(parsedDate)) {
                    // Если год не был указан в формате, используем текущий
                    if (!format.includes('yyyy')) {
                        parsedDate.setFullYear(new Date().getFullYear());
                    }
                    // Устанавливаем время на начало дня в локальной временной зоне
                    const date = setMilliseconds(setSeconds(setMinutes(setHours(parsedDate, 0), 0), 0), 0);
                    
                    // Удаляем первую строку и пустые строки в начале
                    const cleanContent = lines.slice(1)
                        .join('\n')
                        .replace(/^\s+/, '');

                    return { date, cleanContent };
                }
            } catch (e) {
                continue;
            }
        }

        return { date: null, cleanContent: text };
    }
} 