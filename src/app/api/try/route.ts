import { NextResponse } from "next/server";
import { handle, positiveInt } from "@/lib/http";
import { TOOLS } from "@/lib/tools";

// POST /api/try { documentId, operationId, parameters } — the user clicked "İsteği dene".
// This is the only route that runs try_get_request; the model is never given that tool.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    const documentId = positiveInt(body?.documentId);
    if (!documentId || typeof body?.operationId !== "string") {
      return NextResponse.json({ error: "documentId and operationId are required" }, { status: 400 });
    }
    const result = await TOOLS.try_get_request.run({ documentId }, { operation_id: body.operationId, parameters: body.parameters ?? {} });
    if (result && typeof result === "object" && "error" in result) return NextResponse.json(result, { status: 404 });
    return NextResponse.json(result);
  });
}
