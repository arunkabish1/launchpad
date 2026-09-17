import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/store";
import { resolvePat, getProjectStatus, resolveProjectLiveUrl } from "@/lib/status";
import { applyPendingConfig } from "@/lib/runtime-config";
import { requireAuth, authRequiredResponse } from "@/lib/auth";
import type { ProjectStatusResult } from "@/lib/types";

export const runtime = "nodejs";

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  statuses: Record<string, ProjectStatusResult>;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return authRequiredResponse();

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json({ statuses: cache.statuses });
  }

  const statuses: Record<string, ProjectStatusResult> = {};
  const projects = await listProjects();

  await Promise.all(
    projects.map(async (p) => {
      const pat = await resolvePat(p.id);
      if (!pat) {
        statuses[p.id] = {
          latest: null,
          status: "unknown",
          totalRuns: 0,
          runs: [],
          error: "No GitHub token available for this project.",
        };
        return;
      }
      try {
        statuses[p.id] = await getProjectStatus(p.owner, p.repo, pat);
        statuses[p.id].liveUrl = await resolveProjectLiveUrl(p).catch(() => null);
        if (statuses[p.id].status === "success") {
          await applyPendingConfig(p, statuses[p.id]).catch(() => {});
        }
      } catch (err) {
        statuses[p.id] = {
          latest: null,
          status: "unknown",
          totalRuns: 0,
          runs: [],
          error: "Failed to fetch deploy status: " + (err as Error).message,
        };
      }
    })
  );

  cache = { statuses, expiresAt: now + CACHE_TTL_MS };
  return NextResponse.json({ statuses });
}
