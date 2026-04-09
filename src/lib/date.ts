import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const JST_TIME_ZONE = "Asia/Tokyo";
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_LABEL_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

function parseJstDateLike(date: Date | string) {
  if (date instanceof Date) {
    return date;
  }

  if (DATE_ONLY_PATTERN.test(date)) {
    return parseDateOnly(date);
  }

  if (DATE_LABEL_PATTERN.test(date)) {
    return parseDateOnly(date.replaceAll("/", "-"));
  }

  return parseISO(date);
}

export function todayJstKey(now = new Date()) {
  return formatInTimeZone(now, JST_TIME_ZONE, "yyyy-MM-dd");
}

export function toDateKey(date: Date | string) {
  return formatInTimeZone(parseJstDateLike(date), JST_TIME_ZONE, "yyyy-MM-dd");
}

export function toDateInputValue(date?: Date | string | null) {
  return date ? toDateKey(date) : "";
}

export function parseDateOnly(input: string) {
  return new Date(`${input}T00:00:00+09:00`);
}

export function formatDateLabel(date: Date | string) {
  return toDateKey(date).replaceAll("-", "/");
}

export function formatDateTimeLabel(date: Date | string) {
  return formatInTimeZone(parseJstDateLike(date), JST_TIME_ZONE, "yyyy/MM/dd HH:mm");
}

export function addDaysToDateKey(dateKey: string, days: number) {
  return toDateKey(addDays(parseDateOnly(dateKey), days));
}

export function diffDaysFromToday(date: Date | string, today = todayJstKey()) {
  return differenceInCalendarDays(parseISO(toDateKey(date)), parseISO(today));
}

export type ExpiryBucket = "expired" | "today" | "within7" | "within30" | "safe";

export function formatExpiryRelativeLabel(diffDays: number) {
  if (diffDays < 0) {
    return `${Math.abs(diffDays)}日超過`;
  }

  if (diffDays === 0) {
    return "今日まで";
  }

  return `あと${diffDays}日`;
}

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

export function getExpiryStatusMeta(date: Date | string) {
  const diffDays = diffDaysFromToday(date);
  const bucket = getExpiryBucket(diffDays);

  return {
    diffDays,
    bucket,
    relativeLabel: formatExpiryRelativeLabel(diffDays),
    tone:
      bucket === "expired"
        ? ("danger" as const)
        : bucket === "today" || bucket === "within7"
          ? ("warning" as const)
          : bucket === "within30"
            ? ("info" as const)
            : ("success" as const),
    shortLabel:
      bucket === "expired"
        ? "期限切れ"
        : bucket === "today"
          ? "本日"
          : bucket === "within7"
            ? "7日以内"
            : bucket === "within30"
              ? "30日以内"
              : "正常",
  };
}

export type ExtendedBucket = ExpiryBucket | "outOfStock";

export function getBucketMeta(bucket: ExtendedBucket): {
  tone: "danger" | "warning" | "info" | "success" | "neutral";
  label: string;
} {
  switch (bucket) {
    case "expired":
      return { tone: "danger", label: "期限切れ" };
    case "today":
      return { tone: "warning", label: "本日" };
    case "within7":
      return { tone: "warning", label: "7日以内" };
    case "within30":
      return { tone: "info", label: "30日以内" };
    case "outOfStock":
      return { tone: "neutral", label: "在庫なし" };
    case "safe":
    default:
      return { tone: "success", label: "正常" };
  }
}

export function normalizeAlertDays(days: number[]) {
  return Array.from(
    new Set(days.filter((value) => Number.isInteger(value) && value >= 0)),
  ).sort((a, b) => b - a);
}
