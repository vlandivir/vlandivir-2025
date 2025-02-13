import { Injectable } from '@nestjs/common';
import { parse, isValid, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

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

    extractDateFromFirstLine(text: string): Date | null {
        if (!text) return null;
        
        const firstLine = text.split('\n')[0].trim();
        
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
                    return setMilliseconds(setSeconds(setMinutes(setHours(parsedDate, 0), 0), 0), 0);
                }
            } catch (e) {
                continue;
            }
        }

        return null;
    }
} 