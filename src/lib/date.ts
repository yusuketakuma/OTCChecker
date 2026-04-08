import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const JST_TIME_ZONE = "Asia/Tokyo";

export function todayJstKey(now = new Date()) {
  return formatInTimeZone(now, JST_TIME_ZONE, "yyyy-MM-dd");
}

export function toDateKey(date: Date | string) {
  const value = typeof date === "string" ? parseISO(date) : date;
  return formatInTimeZone(value, JST_TIME_ZONE, "yyyy-MM-dd");
}

export function parseDateOnly(input: string) {
  return new Date(`${input}T00:00:00+09:00`);
}

export function formatDateLabel(date: Date | string) {
  return toDateKey(date).replaceAll("-", "/");
}

export function formatDateTimeLabel(date: Date | string) {
  const value = typeof date === "string" ? parseISO(date) : date;
  return formatInTimeZone(value, JST_TIME_ZONE, "yyyy/MM/dd HH:mm");
}

export function addDaysToDateKey(dateKey: string, days: number) {
  return toDateKey(addDays(parseDateOnly(dateKey), days));
}

export function diffDaysFromToday(date: Date | string, today = todayJstKey()) {
  return differenceInCalendarDays(parseISO(toDateKey(date)), parseISO(today));
}

export type ExpiryBucket = "expired" | "today" | "within7" | "within30" | "safe";

export function getExpiryBucket(diffDays: number): ExpiryBucket {
  if (diffDays < 0) {
    return "expired";
  }

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays <= 7) {
    return "within7";
  }

  if (diffDays <= 30) {
    return "within30";
  }

  return "safe";
}

export function normalizeAlertDays(days: number[]) {
  return Array.from(
    new Set(days.filter((value) => Number.isInteger(value) && value >= 0)),
  ).sort((a, b) => b - a);
}
