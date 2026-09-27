import { NextResponse } from "next/server";
import { OpenApiError, parseOpenApi } from "@/lib/openapi";
import { tryOperation } from "@/lib/try-request";

// POST /api/try { document, operationId, parameters } — the user-confirmed request.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.operationId !== "string") {
    return NextResponse.json({ error: "operationId is required" }, { status: 400 });
  }
  try {
    const parsed = parseOpenApi(body.document);
    const op = parsed.operations.find((o) => o.operationId === body.operationId);
    if (!op) return NextResponse.json({ error: `Operation '${body.operationId}' is not in the document.` }, { status: 404 });
    const params = body.parameters && typeof body.parameters === "object" ? body.parameters : {};
    return NextResponse.json(await tryOperation(op, parsed.serverUrl, params));
  } catch (e) {
    if (e instanceof OpenApiError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
