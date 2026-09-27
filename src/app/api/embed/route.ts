import { NextResponse } from "next/server";
import { embedDocument } from "@/lib/indexing";
import { handle, positiveInt } from "@/lib/http";

// POST /api/embed { documentId } — embed operations that are still missing a vector.
export async function POST(req: Request) {
  return handle(async () => {
    const documentId = positiveInt((await req.json().catch(() => null))?.documentId);
    if (!documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    return NextResponse.json(await embedDocument(documentId));
  });
}
