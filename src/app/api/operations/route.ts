import { NextRequest, NextResponse } from "next/server";
import { getOperations } from "@/lib/db";
import { handle, positiveInt } from "@/lib/http";

// GET /api/operations?documentId=1 — stored GET operations, including the exact text that was embedded.
export async function GET(req: NextRequest) {
  return handle(async () => {
    const documentId = positiveInt(req.nextUrl.searchParams.get("documentId"));
    if (!documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    return NextResponse.json(await getOperations(documentId));
  });
}
