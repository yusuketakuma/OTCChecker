import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import { fail, ok } from "@/lib/api";
import { buildSettingsUpdate, getSettings } from "@/lib/settings";
import { getPrisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/validators";

export async function GET() {
  try {
    const settings = await getSettings();
    return ok(settings);
  } catch (error) {
    return fail(500, "SETTINGS_FETCH_FAILED", "設定の取得に失敗しました", error);
  }
}

export async function PUT(request: Request) {
  try {
    const prisma = getPrisma();
    const parsed = settingsSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_SETTINGS", "設定内容が不正です", parsed.error.flatten());
    }

    const normalizedData = {
      ...parsed.data,
      defaultAlertDays: parsed.data.defaultAlertDays,
    };

    const updated = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        ...normalizedData,
      },
      update: buildSettingsUpdate(normalizedData),
    });

    return ok(updated);
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError) {
      return fail(422, "SETTINGS_UPDATE_FAILED", "設定の更新に失敗しました", error.message);
    }

    return fail(500, "SETTINGS_UPDATE_FAILED", "設定の更新に失敗しました", error);
  }
}
