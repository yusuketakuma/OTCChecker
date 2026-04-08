import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => Number(item))
    .filter((item): item is number => Number.isInteger(item));
}
