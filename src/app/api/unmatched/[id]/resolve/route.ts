import { UnmatchedReason } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import { fail, ok } from "@/lib/api";
import { unmatchedResolveSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const parsed = unmatchedResolveSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_RESOLUTION", "解決内容が不正です", parsed.error.flatten());
    }

    const updated = await prisma.unmatchedSale.update({
      where: { id },
      data: {
        reason: UnmatchedReason.MANUAL_RESOLUTION,
        resolved: true,
        resolutionNote: parsed.data.resolutionNote,
      },
    });

    return ok(updated);
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
      return fail(404, "UNMATCHED_NOT_FOUND", "未割当データが見つかりません");
    }

    return fail(500, "UNMATCHED_RESOLVE_FAILED", "未割当の解決に失敗しました", error);
  }
}
