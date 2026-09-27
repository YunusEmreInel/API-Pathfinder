import { NextResponse } from "next/server";
import { getOperation, saveTryRun } from "@/lib/db";
import { handle, positiveInt } from "@/lib/http";
import { tryOperation } from "@/lib/try-request";

// POST /api/try { documentId, operationId, parameters } — the only user-confirmed outbound request.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    const documentId = positiveInt(body?.documentId);
    if (!documentId || typeof body?.operationId !== "string") {
      return NextResponse.json({ error: "documentId and operationId are required" }, { status: 400 });
    }
    const stored = await getOperation(documentId, body.operationId);
    if (!stored) return NextResponse.json({ error: `Operation '${body.operationId}' is not in document ${documentId}.` }, { status: 404 });
    const params = body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters) ? body.parameters : {};
    const outcome = await tryOperation(stored.op, stored.serverUrl, params);
    const runId = await saveTryRun(stored.pk, params, outcome);
    return NextResponse.json({ ...outcome, runId });
  });
}
