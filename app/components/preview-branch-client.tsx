"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTime, formatRelative, shortSha } from "@/lib/format";
import {
  Badge,
  Card,
  CardHeader,
  CopyButton,
  IconArrowLeft,
  IconExternal,
  IconGitHub,
  IconTerminal,
} from "./ui";
import { SkeletonList } from "./skeleton";

interface PreviewDeployRun {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PreviewBranchDetail {
  branch: string;
  previewName: string;
  url: string | null;
  running: boolean;
  worker: { createdOn: string | null; modifiedOn: string | null } | null;
  deploy: PreviewDeployRun | null;
  git: {
    name: string;
    sha: string;
    message: string;
    authorName: string | null;
    authorDate: string | null;
    htmlUrl: string;
    protected: boolean;
  } | null;
  resources: Array<{ type: string; name: string; id: string }>;
  secrets: string[];
  warnings: string[];
}

const RESOURCE_STYLE: Record<string, string> = {
  kv: "bg-sky-500/15 text-sky-300",
  d1: "bg-emerald-500/15 text-emerald-300",
  r2: "bg-purple-500/15 text-purple-300",
  turnstile: "bg-teal-500/15 text-teal-300",
  ai_search: "bg-indigo-500/15 text-indigo-300",
};

const RESOURCE_LABEL: Record<string, string> = {
  kv: "KV namespace",
  d1: "D1 database",
  r2: "R2 bucket",
  turnstile: "Turnstile widget",
  ai_search: "AI Search instance",
};

function deployState(run: PreviewDeployRun | null): { label: string; cls: string } {
  if (!run) return { label: "No runs yet", cls: "bg-slate-700/30 text-slate-400" };
  const c = run.conclusion;
  const s = run.status;
  if (c === "success") return { label: "Success", cls: "bg-emerald-500/15 text-emerald-300" };
  if (c === "failure" || c === "timed_out" || c === "startup_failure")
    return { label: "Failed", cls: "bg-red-500/15 text-red-300" };
  if (c === "cancelled") return { label: "Cancelled", cls: "bg-amber-500/15 text-amber-300" };
  if (s === "in_progress" || s === "queued" || s === "pending" || s === "requested" || s === "waiting")
    return { label: s.replace(/_/g, " "), cls: "bg-amber-500/15 text-amber-300" };
  if (c) return { label: c.replace(/_/g, " "), cls: "bg-slate-700/30 text-slate-400" };
  return { label: s.replace(/_/g, " "), cls: "bg-slate-700/30 text-slate-400" };
}

interface PreviewBranchClientProps {
  projectId: string;
  branch: string;
}

export default function PreviewBranchClient({ projectId, branch }: PreviewBranchClientProps) {
  const [detail, setDetail] = useState<PreviewBranchDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/preview/${encodeURIComponent(branch)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setDetail(data);
          setError(null);
        } else {
          setError(data.error ?? "Failed to load preview branch details.");
        }
      } catch {
        if (!cancelled) setError("Failed to reach the Launchpad server.");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, branch]);

  const deploy = detail ? deployState(detail.deploy) : null;

  return (
    <div className="fixed inset-y-0 right-0 left-0 top-16 z-20 flex flex-col bg-[#040a14] lg:top-0 lg:left-[var(--sidebar-w,16rem)]">
      <div className="flex items-center justify-between border-b border-slate-800/70 bg-[#080f1e] px-6 py-3.5">
        <div className="flex items-center gap-4">
          <Link
            href={`/projects/${projectId}`}
            className="flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to project
          </Link>
          <span className="h-5 w-px bg-slate-800" />
          <div className="flex items-center gap-2.5">
            <IconTerminal className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-200">Preview Branch</span>
            <span className="rounded-md border border-[#f6821f]/25 bg-[#f6821f]/10 px-2 py-0.5 font-mono text-[11px] text-[#f6821f]">
              {branch}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {error && (
            <div className="mb-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              {error}
            </div>
          )}

          {!loaded ? (
            <Card>
              <CardHeader title={branch} />
              <div className="p-5">
                <SkeletonList rows={4} />
              </div>
            </Card>
          ) : detail ? (
            <div className="space-y-4">
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        detail.running
                          ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                          : "bg-slate-600"
                      }`}
                    />
                    <h1 className="truncate font-mono text-lg font-semibold text-slate-100">
                      {detail.branch}
                    </h1>
                    <Badge
                      className={
                        detail.running
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-slate-700/30 text-slate-400"
                      }
                    >
                      {detail.running ? "Live" : "Not deployed"}
                    </Badge>
                  </div>
                  {detail.url && (
                    <div className="flex items-center gap-2">
                      <a
                        href={detail.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#f6821f] px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-[#ff9436]"
                      >
                        <IconExternal className="h-3.5 w-3.5" />
                        Open preview
                      </a>
                      <CopyButton text={detail.url} label="Copy URL" />
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-800/80 px-5 py-3">
                  <p className="truncate font-mono text-xs text-slate-500">{detail.previewName}</p>
                  {!detail.running && (
                    <p className="mt-2 text-sm text-slate-500">
                      No preview deployed for this branch yet. Push a commit to{" "}
                      <code className="font-mono text-slate-300">{detail.branch}</code> to spin one
                      up.
                    </p>
                  )}
                </div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader title="Worker" />
                  <dl className="divide-y divide-slate-800/60">
                    <div className="flex items-center justify-between px-5 py-3">
                      <dt className="text-xs text-slate-500">Status</dt>
                      <dd className="text-sm font-medium text-slate-200">
                        {detail.running ? "Running" : "Not deployed"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3">
                      <dt className="text-xs text-slate-500">Created</dt>
                      <dd className="text-right text-sm text-slate-300">
                        {detail.worker
                          ? `${formatRelative(detail.worker.createdOn)} · ${formatDateTime(detail.worker.createdOn)}`
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3">
                      <dt className="text-xs text-slate-500">Last modified</dt>
                      <dd className="text-right text-sm text-slate-300">
                        {detail.worker
                          ? `${formatRelative(detail.worker.modifiedOn)} · ${formatDateTime(detail.worker.modifiedOn)}`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </Card>

                <Card>
                  <CardHeader title="Deploy" />
                  <dl className="divide-y divide-slate-800/60">
                    <div className="flex items-center justify-between px-5 py-3">
                      <dt className="text-xs text-slate-500">Latest run</dt>
                      <dd>
                        {deploy && <Badge className={deploy.cls}>{deploy.label}</Badge>}
                        {!deploy && <span className="text-sm text-slate-500">—</span>}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3">
                      <dt className="text-xs text-slate-500">Updated</dt>
                      <dd className="text-sm text-slate-300">
                        {detail.deploy ? formatRelative(detail.deploy.updatedAt) : "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3">
                      <dt className="text-xs text-slate-500">Run</dt>
                      <dd>
                        {detail.deploy ? (
                          <a
                            href={detail.deploy.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 font-mono text-xs text-[#ff9436] hover:underline"
                          >
                            #{detail.deploy.runId}
                            <IconGitHub className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-sm text-slate-500">—</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </Card>

                <Card>
                  <CardHeader title="Resources" count={detail.resources.length} />
                  <div className="px-5 py-4">
                    {detail.resources.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {detail.resources.map((r) => (
                          <span
                            key={`${r.type}:${r.id}`}
                            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs ${RESOURCE_STYLE[r.type] ?? "bg-slate-800 text-slate-300"}`}
                          >
                            {r.name}
                            <span className="text-[10px] opacity-70">
                              {RESOURCE_LABEL[r.type] ?? r.type}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No per-branch KV, D1, R2, AI Search, or Turnstile resources provisioned.
                      </p>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Environment" count={detail.secrets.length} />
                  <div className="px-5 py-4">
                    {detail.secrets.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {detail.secrets.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1.5 rounded bg-slate-800/80 px-2 py-1 font-mono text-xs text-slate-300"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No secrets set on this preview worker. It uses the same environment
                        variables as this project.
                      </p>
                    )}
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader title="Branch" action={detail.git && (
                  <a
                    href={detail.git.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#ff9436] hover:underline"
                  >
                    <IconGitHub className="h-3.5 w-3.5" />
                    Latest commit
                  </a>
                )} />
                <div className="px-5 py-4">
                  {detail.git ? (
                    <div className="space-y-2">
                      <p className="truncate text-sm text-slate-200">
                        <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                          {shortSha(detail.git.sha)}
                        </span>
                        {detail.git.message.split("\n")[0]}
                      </p>
                      <p className="text-xs text-slate-500">
                        {detail.git.authorName ?? "Unknown author"} ·{" "}
                        {formatRelative(detail.git.authorDate)} ·{" "}
                        {formatDateTime(detail.git.authorDate)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Branch info unavailable.</p>
                  )}
                </div>
              </Card>

              {detail.warnings.length > 0 && (
                <div className="rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                  {detail.warnings.join(" ")}
                </div>
              )}
            </div>
          ) : (
            <Card>
              <CardHeader title={branch} />
              <p className="px-5 pb-5 text-sm text-slate-500">No details available.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
