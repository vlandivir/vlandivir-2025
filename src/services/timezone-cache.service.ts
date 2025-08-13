import { Injectable } from '@nestjs/common';

@Injectable()
export class TimeZoneCacheService {
  private readonly chatIdToTimeZone: Map<number, string> = new Map();

  public setTimeZone(chatId: number, timeZone: string): void {
    if (!chatId || !timeZone) return;
    this.chatIdToTimeZone.set(chatId, timeZone);
  }

  public getTimeZone(chatId?: number): string | undefined {
    if (!chatId) return undefined;
    return this.chatIdToTimeZone.get(chatId);
  }
}
