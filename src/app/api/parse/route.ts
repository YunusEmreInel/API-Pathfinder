import { NextResponse } from "next/server";
import { OpenApiError, parseOpenApi } from "@/lib/openapi";

// POST /api/parse { document } -> extracted GET operations (no database, no outbound calls)
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(parseOpenApi(body?.document));
  } catch (e) {
    if (e instanceof OpenApiError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
