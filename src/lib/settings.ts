import { Prisma } from "@prisma/client";

import { normalizeAlertDays } from "@/lib/date";
import { getPrisma } from "@/lib/prisma";

export const defaultSettings = {
  id: "singleton",
  defaultAlertDays: [30, 7, 0] as Prisma.InputJsonValue,
  timezone: "Asia/Tokyo",
};

function readAlertDays(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [30, 7, 0];
  }

  return normalizeAlertDays(
    value
      .map((item) => (typeof item === "number" ? item : Number(item)))
      .filter((item) => Number.isInteger(item) && item >= 0),
  );
}

export async function getSettings() {
  const prisma = getPrisma();
  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: defaultSettings,
    update: {},
  });

  return {
    ...settings,
    defaultAlertDays: readAlertDays(settings.defaultAlertDays),
  };
}

export function buildSettingsUpdate(data: {
  defaultAlertDays?: number[];
}) {
  const update: Prisma.AppSettingsUpdateInput = {};

  if (data.defaultAlertDays) {
    update.defaultAlertDays = normalizeAlertDays(data.defaultAlertDays) as Prisma.InputJsonValue;
  }

  return update;
}
