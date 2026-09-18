import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/store";
import { resolvePat, getProjectStatus, resolveProjectLiveUrl } from "@/lib/status";
import { applyPendingConfig } from "@/lib/runtime-config";
import { requireAuth, authRequiredResponse } from "@/lib/auth";
import { filterAccessibleProjects } from "@/lib/membership";
import type { ProjectStatusResult } from "@/lib/types";

export const runtime = "nodejs";

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  statuses: Record<string, ProjectStatusResult>;
  expiresAt: number;
}

let cache: Map<string, CacheEntry> = new Map();

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return authRequiredResponse();

  const cacheKey = `${auth.user.id}:${auth.user.globalRole}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ statuses: cached.statuses });
  }

  const statuses: Record<string, ProjectStatusResult> = {};
  const projects = await filterAccessibleProjects(auth.user, await listProjects());

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

  cache.set(cacheKey, { statuses, expiresAt: now + CACHE_TTL_MS });
  if (cache.size > 50) cache = new Map();
  return NextResponse.json({ statuses });
}
