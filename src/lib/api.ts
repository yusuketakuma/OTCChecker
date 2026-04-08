import { NextResponse } from "next/server";

export type ApiSuccess<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiError = {
  error: string;
  code: string;
  details?: unknown;
};

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json<ApiSuccess<T>>(meta ? { data, meta } : { data });
}

export function fail(
  status: number,
  code: string,
  error: string,
  details?: unknown,
) {
  return NextResponse.json<ApiError>(
    details ? { error, code, details } : { error, code },
    { status },
  );
}
