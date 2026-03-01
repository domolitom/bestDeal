import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export async function GET() {
  const countries = await storage.listCountries();
  return NextResponse.json(countries);
}
