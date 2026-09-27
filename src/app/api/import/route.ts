import { NextResponse } from "next/server";
import { parseOpenApi } from "@/lib/openapi";
import { insertDocument } from "@/lib/db";
import { handle } from "@/lib/http";

const MAX_DOC_BYTES = 1_000_000;

// POST /api/import { document } — validate, extract GET operations, store them.
export async function POST(req: Request) {
  return handle(async () => {
    const text = await req.text();
    if (text.length > MAX_DOC_BYTES) return NextResponse.json({ error: "Document is larger than 1 MB." }, { status: 413 });
    const body = JSON.parse(text || "{}");
    const raw = typeof body.document === "string" ? JSON.parse(body.document) : body.document;
    const parsed = parseOpenApi(raw);
    const { documentId, operations } = await insertDocument(parsed, raw);
    return NextResponse.json({
      documentId,
      title: parsed.title,
      serverUrl: parsed.serverUrl,
      operationCount: operations.length,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    });
  });
}
