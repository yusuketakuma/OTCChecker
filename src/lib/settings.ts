import { Prisma } from "@prisma/client";

import { normalizeAlertDays } from "@/lib/date";
import { prisma } from "@/lib/prisma";

export const defaultSettings = {
  id: "singleton",
  defaultAlertDays: [30, 7, 0],
  timezone: "Asia/Tokyo",
};

export async function getSettings() {
  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: defaultSettings,
    update: {},
  });

  return {
    ...settings,
    defaultAlertDays: normalizeAlertDays(settings.defaultAlertDays),
  };
}

export function buildSettingsUpdate(data: {
  defaultAlertDays?: number[];
}) {
  const update: Prisma.AppSettingsUpdateInput = {};

  if (data.defaultAlertDays) {
    update.defaultAlertDays = normalizeAlertDays(data.defaultAlertDays);
  }

  return update;
}
