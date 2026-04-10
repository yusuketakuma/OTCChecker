import type { Prisma } from "@prisma/client";

import { normalizeAlertDays } from "@/lib/date";

export function readAlertDays(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [30, 7, 0];
  }

  return normalizeAlertDays(
    value
      .map((item) => (typeof item === "number" ? item : Number(item)))
      .filter((item): item is number => Number.isInteger(item) && item >= 0),
  );
}
