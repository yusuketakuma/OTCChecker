import { fail, ok } from "@/lib/api";
import { getDashboardSummary } from "@/lib/inventory";

export async function GET() {
  try {
    const summary = await getDashboardSummary();
    return ok(summary);
  } catch (error) {
    return fail(500, "DASHBOARD_FETCH_FAILED", "ダッシュボード取得に失敗しました", error);
  }
}
