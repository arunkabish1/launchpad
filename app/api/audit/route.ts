import { NextRequest, NextResponse } from "next/server";
import { listAudits } from "@/lib/audit";
import { requireAuth, authRequiredResponse } from "@/lib/auth";
import { listProjects } from "@/lib/store";
import { filterAccessibleProjects } from "@/lib/membership";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const project = req.nextUrl.searchParams.get("project");

  const accessible = await filterAccessibleProjects(auth.user, await listProjects());
  const names = new Set(accessible.map((p) => p.name));

  if (project && !names.has(project)) {
    return NextResponse.json({ error: "You don't have access to this project." }, { status: 403 });
  }

  let audits = await listAudits(Number.isFinite(limit) ? limit : 100);
  audits = audits.filter((a) => names.has(a.project));
  if (project) {
    audits = audits.filter((a) => a.project === project);
  }
  return NextResponse.json({ audits });
}
