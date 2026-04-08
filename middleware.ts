import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";

export function middleware(request: NextRequest) {
  if (!env.appGateToken) {
    return NextResponse.next();
  }

  const protectedPrefixes = env.appGatePaths
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const isProtected = protectedPrefixes.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const token = request.headers.get("x-app-gate-token");

  if (token === env.appGateToken) {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      error: "Unauthorized",
      code: "APP_GATE_REQUIRED",
    },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png).*)"],
};
