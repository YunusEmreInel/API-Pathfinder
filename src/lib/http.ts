import { NextResponse } from "next/server";
import { OpenApiError } from "./openapi";
import { MissingKeyError } from "./gemini";

/** Turns expected errors into readable JSON responses; unexpected ones become 500 with a message. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OpenApiError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof MissingKeyError) return NextResponse.json({ error: e.message, missingKey: true }, { status: 503 });
    const err = e as Error & { code?: string };
    console.error("[api]", err);
    const hint = err.code === "ECONNREFUSED" ? " Is the database running? Try: npm run db:up" : "";
    return NextResponse.json({ error: `${err.message}${hint}` }, { status: 500 });
  }
}

export function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
