import { ok } from "@/lib/api";
import { getBuildInfo } from "@/lib/build-info";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(getBuildInfo(), {
    verifiedBy: "version-route",
  });
}
