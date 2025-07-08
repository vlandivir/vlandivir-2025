import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { HistoryCommandsService } from '../telegram-bot/history-commands.service';

@Controller('history')
export class HistoryController {
    constructor(private readonly historyCommandsService: HistoryCommandsService) {}

    @Get(':secretId')
    async getHistoryPage(@Param('secretId') secretId: string, @Res() res: Response) {
        const htmlContent = this.historyCommandsService.getHtmlContent(secretId);
        
        if (!htmlContent) {
            return res.status(HttpStatus.NOT_FOUND).send('Страница не найдена или устарела');
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(htmlContent);
    }
} 