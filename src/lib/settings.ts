import { LineTargetType, Prisma } from "@prisma/client";

import { normalizeAlertDays } from "@/lib/date";
import { prisma } from "@/lib/prisma";

export const defaultSettings = {
  id: "singleton",
  defaultAlertDays: [30, 7, 0],
  timezone: "Asia/Tokyo",
  lineTargetType: LineTargetType.NONE,
  lineTargetId: null,
  lineEnabled: false,
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
  lineTargetType?: LineTargetType;
  lineTargetId?: string | null;
  lineEnabled?: boolean;
}) {
  const update: Prisma.AppSettingsUpdateInput = {};

  if (data.defaultAlertDays) {
    update.defaultAlertDays = normalizeAlertDays(data.defaultAlertDays);
  }

  if (typeof data.lineTargetType !== "undefined") {
    update.lineTargetType = data.lineTargetType;
  }

  if (typeof data.lineTargetId !== "undefined") {
    update.lineTargetId = data.lineTargetId;
  }

  if (typeof data.lineEnabled === "boolean") {
    update.lineEnabled = data.lineEnabled;
  }

  return update;
}
