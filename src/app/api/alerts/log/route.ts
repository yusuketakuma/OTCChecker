import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const logs = await prisma.alertLog.findMany({
      orderBy: { sentAt: "desc" },
      take: 100,
      include: {
        lot: {
          include: {
            product: true,
          },
        },
      },
    });

    return ok(logs);
  } catch (error) {
    return fail(500, "ALERT_LOG_FETCH_FAILED", "通知履歴の取得に失敗しました", error);
  }
}
