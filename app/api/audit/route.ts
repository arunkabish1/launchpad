import { NextRequest, NextResponse } from "next/server";
import { listAudits } from "@/lib/audit";
import { requireAuth, authRequiredResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const project = req.nextUrl.searchParams.get("project");
  let audits = await listAudits(Number.isFinite(limit) ? limit : 100);
  if (project) {
    audits = audits.filter((a) => a.project === project);
  }
  return NextResponse.json({ audits });
}
