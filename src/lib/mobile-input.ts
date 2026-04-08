import type { InputHTMLAttributes } from "react";

import { normalizeJanCode } from "@/lib/csv";

type InputAttributes = InputHTMLAttributes<HTMLInputElement>;

export const janInputProps = {
  type: "text",
  inputMode: "numeric",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  pattern: "[0-9]*",
  maxLength: 14,
} satisfies InputAttributes;

export const positiveIntegerInputProps = {
  type: "number",
  inputMode: "numeric",
  autoComplete: "off",
  min: 1,
  step: 1,
} satisfies InputAttributes;

export const nonNegativeIntegerInputProps = {
  ...positiveIntegerInputProps,
  min: 0,
} satisfies InputAttributes;

export const signedIntegerInputProps = {
  type: "number",
  autoComplete: "off",
  step: 1,
} satisfies InputAttributes;

export function sanitizeJanInput(value: string) {
  return normalizeJanCode(value).slice(0, 14);
}

export function parsePositiveIntegerInput(value: string) {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function coercePositiveIntegerInput(value: string, fallback = 1) {
  return parsePositiveIntegerInput(value) ?? fallback;
}
