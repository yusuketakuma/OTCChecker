import { fail, ok } from "@/lib/api";
import { getBuildInfo } from "@/lib/build-info";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const build = getBuildInfo();

  try {
    const prisma = await getPrisma();
    await prisma.appSettings.count();

    return ok({
      status: "ok",
      checkedAt: new Date().toISOString(),
      build,
      database: {
        ok: true,
        check: "appSettings.count",
      },
    });
  } catch (error) {
    return fail(503, "HEALTH_CHECK_FAILED", "ヘルスチェックに失敗しました", {
      status: "degraded",
      checkedAt: new Date().toISOString(),
      build,
      database: {
        ok: false,
        check: "appSettings.count",
      },
      cause:
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
            }
          : "unknown",
    });
  }
}
