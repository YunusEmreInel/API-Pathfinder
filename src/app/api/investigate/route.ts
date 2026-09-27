import { NextResponse } from "next/server";
import { ragInvestigate } from "@/lib/rag";
import { saveInvestigation } from "@/lib/db";
import { handle, positiveInt } from "@/lib/http";

// POST /api/investigate { documentId, goal } — never sends a request to the target API.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    const documentId = positiveInt(body?.documentId);
    const goal = typeof body?.goal === "string" ? body.goal.trim().slice(0, 500) : "";
    if (!documentId || !goal) return NextResponse.json({ error: "documentId and goal are required" }, { status: 400 });
    const result = await ragInvestigate(documentId, goal);
    const id = await saveInvestigation(documentId, goal, result.mode, result, result.model.answer?.reasoning ?? null);
    return NextResponse.json({ ...result, investigationId: id });
  });
}
