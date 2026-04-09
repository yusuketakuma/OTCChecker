import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { normalizeAlertDays } from "@/lib/date";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatQuantity(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

export function formatLotNumber(value: string) {
  return `LOT-${value.slice(0, 8).toUpperCase()}`;
}

export function parseCommaSeparatedIntegers(input: string) {
  return input
    .replaceAll("、", ",")
    .replaceAll("，", ",")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => Number(item))
    .filter((item): item is number => Number.isInteger(item));
}

export function parseAlertDaysInput(input: string) {
  const values = parseCommaSeparatedIntegers(input);
  const normalized = normalizeAlertDays(values);

  if (values.length === 0) {
    return {
      values: normalized,
      normalizedText: "",
      error: "アラート日数を1件以上入力してください。",
    };
  }

  if (values.some((value) => value < 0 || value > 365)) {
    return {
      values: normalized,
      normalizedText: normalized.join(","),
      error: "アラート日数は0〜365の整数で入力してください。",
    };
  }

  if (normalized.length > 10) {
    return {
      values: normalized,
      normalizedText: normalized.join(","),
      error: "アラート日数は10件以内で入力してください。",
    };
  }

  return {
    values: normalized,
    normalizedText: normalized.join(","),
    error: "",
  };
}

export function buildScanHref(params: {
  janCode?: string;
  name?: string;
  spec?: string;
  expiryDate?: string;
  quantity?: number;
}) {
  const searchParams = new URLSearchParams();

  if (params.janCode) {
    searchParams.set("jan", params.janCode);
  }

  if (params.name) {
    searchParams.set("name", params.name);
  }

  if (params.spec) {
    searchParams.set("spec", params.spec);
  }

  if (params.expiryDate) {
    searchParams.set("expiryDate", params.expiryDate);
  }

  if (typeof params.quantity === "number" && Number.isFinite(params.quantity) && params.quantity > 0) {
    searchParams.set("quantity", String(params.quantity));
  }

  const query = searchParams.toString();

  return query ? `/scan?${query}` : "/scan";
}
