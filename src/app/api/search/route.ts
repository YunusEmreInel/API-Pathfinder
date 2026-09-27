import { NextResponse } from "next/server";
import { searchOperations } from "@/lib/search";
import { handle, positiveInt } from "@/lib/http";

// POST /api/search { documentId, query } — raw pgvector results, no model involved.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    const documentId = positiveInt(body?.documentId);
    const query = typeof body?.query === "string" ? body.query.trim().slice(0, 500) : "";
    if (!documentId || !query) return NextResponse.json({ error: "documentId and query are required" }, { status: 400 });
    const hits = await searchOperations(documentId, query, 10);
    return NextResponse.json(hits.map((h) => ({
      operationId: h.op.operationId, path: h.op.path, summary: h.op.summary,
      distance: h.distance, similarity: h.similarity, embedText: h.embedText, executable: h.op.blockers.length === 0,
    })));
  });
}
