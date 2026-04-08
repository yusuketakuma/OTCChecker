import { fail, ok } from "@/lib/api";
import { hasLineCredentials } from "@/lib/env";
import { sendLineMessage } from "@/lib/line";
import { getSettings } from "@/lib/settings";

export async function POST() {
  try {
    const settings = await getSettings();

    if (!settings.lineEnabled || !settings.lineTargetId) {
      return fail(422, "LINE_NOT_READY", "LINE 通知先が未設定です");
    }

    if (!hasLineCredentials()) {
      return fail(422, "LINE_CREDENTIALS_MISSING", "LINE 資格情報が不足しています");
    }

    await sendLineMessage({
      to: settings.lineTargetId,
      text: "OTCChecker からのテスト通知です。",
    });

    return ok({ success: true });
  } catch (error) {
    return fail(500, "LINE_TEST_FAILED", "テスト通知に失敗しました", error);
  }
}
