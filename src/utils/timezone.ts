import { Context } from 'telegraf';

export function getUserTimeZone(ctx?: Context): string {
  const from = (ctx as Context & { from?: { time_zone?: string } })?.from;
  return from?.time_zone || process.env.USER_TIME_ZONE || 'UTC';
}
