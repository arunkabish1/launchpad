import { NextRequest, NextResponse } from "next/server";
import { listTemplates } from "@/lib/templates";
import { requireAuth, authRequiredResponse } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return authRequiredResponse();
  return NextResponse.json({ templates: listTemplates() });
}
