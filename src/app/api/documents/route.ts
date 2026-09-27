import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/db";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/documents — recently imported documents.
export async function GET() {
  return handle(async () => NextResponse.json(await listDocuments()));
}
