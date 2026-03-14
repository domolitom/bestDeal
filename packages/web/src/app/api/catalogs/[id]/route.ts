import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export const runtime = "edge";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const catalog = await storage.getCatalog(id);

  if (!catalog) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }

  return NextResponse.json(catalog);
}
