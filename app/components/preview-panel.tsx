"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DeployTarget } from "@/lib/types";
import { SkeletonList } from "./skeleton";
import { Badge, Card, CardHeader } from "./ui";

interface PreviewDeployment {
  branch: string;
  previewName: string;
  url: string | null;
  running: boolean;
  sha: string;
  createdOn: string | null;
  modifiedOn: string | null;
}

interface PreviewInfo {
  enabled: boolean;
  previews: PreviewDeployment[];
  warning: string | null;
}

interface PreviewPanelProps {
  projectId: string;
  projectName: string;
  projectType: DeployTarget;
}

export default function PreviewPanel({ projectId, projectName, projectType }: PreviewPanelProps) {
  const [info, setInfo] = useState<PreviewInfo>({ enabled: false, previews: [], warning: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((data: PreviewInfo) => {
    setInfo({
      enabled: data.enabled ?? false,
      previews: data.previews ?? [],
      warning: data.warning ?? null,
    });
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/preview`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        apply(data);
      } else {
        setError(data.error ?? "Failed to load preview settings.");
      }
    } catch {
      setError("Failed to reach the Launchpad server.");
    } finally {
      setLoaded(true);
    }
  }, [projectId, apply]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/preview`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          apply(data);
        } else {
          setError(data.error ?? "Failed to load preview settings.");
        }
      } catch {
        if (!cancelled) setError("Failed to reach the Launchpad server.");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [projectId, apply]);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update preview settings.");
        return;
      }
      setNotice(
        next
          ? "Preview deployments enabled. Push to any branch to spin up a preview worker."
          : "Preview deployments disabled. Teardown runs for existing previews on their next branch event."
      );
      await load();
    } catch {
      setError("Network error while updating preview settings.");
    } finally {
      setBusy(false);
    }
  }

  if (projectType !== "worker") {
    return (
      <Card>
        <CardHeader title="Preview deployments" />
        <p className="px-5 pb-5 text-sm text-slate-500">
          Per-branch preview deployments are not yet supported for Pages projects.
        </p>
      </Card>
    );
  }

  const runningCount = info.previews.filter((p) => p.running).length;

  return (
    <Card>
      <CardHeader
        title="Preview deployments"
        count={info.previews.length}
        action={
          <Badge
            className={
              info.enabled
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-slate-700/30 text-slate-400"
            }
          >
            {info.enabled ? "Enabled" : "Disabled"}
          </Badge>
        }
      />

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="mx-5 mt-4 rounded-md border border-sky-800/50 bg-sky-950/30 px-3 py-2 text-xs text-sky-300">
          {notice}
        </div>
      )}

      {info.warning && (
        <div className="mx-5 mt-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {info.warning}
        </div>
      )}

      <div className="px-5 py-4">
        {!loaded ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {info.previews.length > 0 ? (
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {runningCount} of {info.previews.length} branches deployed
                  </span>
                  <span>Click a branch for details</span>
                </div>
                <div className="divide-y divide-slate-800/60 rounded-md border border-slate-800/60">
                  {info.previews.map((p) => (
                    <div
                      key={p.branch}
                      className="flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-slate-800/40"
                    >
                      <Link
                        href={`/projects/${projectId}/preview/${encodeURIComponent(p.branch)}`}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            p.running
                              ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                              : "bg-slate-600"
                          }`}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-sm font-medium text-slate-200 group-hover:text-white">
                            {p.branch}
                          </span>
                          <span className="truncate font-mono text-xs text-slate-500">
                            {p.previewName}
                          </span>
                        </span>
                        {!p.running && (
                          <span className="ml-2 shrink-0 text-xs text-slate-500">not deployed</span>
                        )}
                      </Link>
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 max-w-[40%] truncate font-mono text-xs text-[#ff9436] hover:underline"
                        >
                          {p.url.replace(/^https:\/\//, "")}
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mb-4 text-sm text-slate-500">
                {info.enabled
                  ? "No branches with previews yet. Push to any branch (other than main) to deploy one."
                  : "Preview deployments are off. Enable them to get a preview worker for every branch."}
              </p>
            )}

            <button
              type="button"
              onClick={() => toggle(!info.enabled)}
              disabled={busy}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                info.enabled
                  ? "border border-slate-700 text-slate-300 hover:border-red-700 hover:text-red-300"
                  : "bg-[#f6821f] text-slate-950 hover:bg-[#ff9436]"
              }`}
            >
              {busy ? "…" : info.enabled ? "Disable" : "Enable previews"}
            </button>
          </>
        )}
      </div>

      <div className="mx-5 mb-5 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
        Each branch gets its own worker <code className="font-mono text-slate-400">{projectName}-&#123;branch&#125;</code>,
        with separate KV/D1/R2 resources and the same environment variables as this project. Workers
        are torn down when the branch is deleted or its PR closes.
      </div>
    </Card>
  );
}
