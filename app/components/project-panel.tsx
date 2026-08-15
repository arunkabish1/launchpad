"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DeployRun, Project, ProjectStatusResult } from "@/lib/types";
import { getStatusMeta } from "./status-meta";
import { formatRelative, formatDateTime, shortSha } from "@/lib/format";
import {
  Badge,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  IconBox,
  IconClock,
  IconExternal,
  IconGitHub,
  IconMore,
  IconRefresh,
  IconRocket,
  IconTrash,
  IconTerminal,
} from "./ui";
import LogsModal from "./logs-modal";
import DeleteProjectModal from "./delete-project-modal";
import EnvPanel from "./env-panel";
import BindingsPanel from "./bindings-panel";
import PreviewPanel from "./preview-panel";
import ProvisionPanel from "./provision-panel";
import ActivityPanel from "./activity-panel";

interface ProjectTemplateInfo {
  name: string;
  source: string;
  stack: string;
  buildCommand: string;
  setup: string;
  deployCommand: string;
  requiresRoute: boolean;
  fileCount: number;
}

interface ProjectPanelProps {
  project: Project;
  template: ProjectTemplateInfo;
  liveUrl: string | null;
  initialStatus: ProjectStatusResult | null;
  initialError: string | null;
}

function runMeta(run: DeployRun) {
  if (run.status === "queued") return getStatusMeta("queued");
  if (run.status === "in_progress") return getStatusMeta("running");
  if (run.status === "completed") {
    if (run.conclusion === "success") return getStatusMeta("success");
    if (run.conclusion === "failure") return getStatusMeta("failure");
    if (run.conclusion === "cancelled") return getStatusMeta("cancelled");
  }
  return getStatusMeta("unknown");
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function Meta({ label, value, copy }: { label: string; value: ReactNode; copy?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-300">{value}</span>
      {copy && <CopyButton text={copy} iconOnly />}
    </div>
  );
}

function OverflowMenu({
  onViewRepo,
  onDelete,
}: {
  onViewRepo: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700/80 bg-slate-800/40 text-slate-400 transition-all hover:border-slate-600 hover:bg-slate-700/60 hover:text-white"
      >
        <IconMore />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 py-1 shadow-2xl">
          <button
            type="button"
            onClick={() => { setOpen(false); onViewRepo(); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-slate-800"
          >
            <IconExternal className="h-4 w-4" />
            View repo
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-950/40"
          >
            <IconTrash className="h-4 w-4" />
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tab types ────────────────────────────────────────────────────────────────
type TabId = "overview" | "deploys" | "env" | "bindings" | "activity";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "deploys", label: "Deploy History" },
  { id: "env", label: "Environment" },
  { id: "bindings", label: "Bindings" },
  { id: "activity", label: "Activity" },
];

// Static branch list for live logs
const BRANCHES = ["main", "dev", "staging", "feature/preview", "fix/hotfix"];

export default function ProjectPanel({
  project,
  template,
  liveUrl,
  initialStatus,
  initialError,
}: ProjectPanelProps) {
  const [status, setStatus] = useState<ProjectStatusResult | null>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [logsRun, setLogsRun] = useState<number | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [liveLogsBranch, setLiveLogsBranch] = useState("main");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/status`);
      const data = await res.json();
      if (res.ok) {
        setStatus(data as ProjectStatusResult);
        setError(null);
      } else {
        setError(data.error ?? "Failed to fetch status.");
      }
    } catch {
      setError("Failed to reach the Launchpad server.");
    }
  }, [project.id]);

  useEffect(() => {
    const interval = setInterval(refresh, 6000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleRedeploy() {
    setRedeploying(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/redeploy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to trigger re-deploy.");
        return;
      }
      setNotice("Re-deploy triggered — a new workflow run is starting.");
      await refresh();
    } catch {
      setError("Network error while triggering re-deploy.");
    } finally {
      setRedeploying(false);
    }
  }

  const meta = getStatusMeta(status?.status);
  const latest = status?.latest;
  const runs = status?.runs ?? [];

  const typeBadge =
    project.type === "pages"
      ? "bg-purple-500/15 text-purple-300"
      : "bg-sky-500/15 text-sky-300";

  return (
    <div className="min-h-dvh">
      {/* ══════════════════════════════════════════════
          HERO HEADER
      ══════════════════════════════════════════════ */}
      <div
        className="relative overflow-hidden border-b border-slate-800/70"
        style={{
          background:
            "linear-gradient(160deg, #0d1f3c 0%, #0a1628 45%, #060d1a 100%)",
        }}
      >
        {/* Ambient glow */}
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full opacity-60"
          style={{
            background:
              "radial-gradient(circle, rgba(246,130,31,0.07) 0%, transparent 70%)",
          }}
        />

        <div className="mx-auto max-w-screen-xl px-6 sm:px-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 pt-5 pb-1 text-xs text-slate-500">
            <Link href="/projects" className="transition-colors hover:text-[#f6821f]">
              Projects
            </Link>
            <span>/</span>
            <span className="text-slate-300">{project.name}</span>
          </div>

          {/* Hero body */}
          <div className="flex flex-wrap items-start justify-between gap-5 py-5">
            {/* Left: avatar + meta */}
            <div className="flex items-start gap-4">
              <div
                className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-extrabold text-white"
                style={{
                  background: "linear-gradient(135deg, #f6821f 0%, #9a3e00 100%)",
                  boxShadow: "0 4px 20px rgba(246,130,31,0.35)",
                }}
              >
                {project.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-white">
                    {project.name}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.className}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${meta.dotClass} ${
                        meta.pulse ? "animate-pulse" : ""
                      }`}
                    />
                    {meta.label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a
                    href={project.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-[#f6821f]"
                  >
                    <IconGitHub className="h-3.5 w-3.5" />
                    {project.owner}/{project.repo}
                  </a>
                  <Badge className={typeBadge}>{project.type}</Badge>
                  <Badge className="bg-slate-800/70 text-slate-400">{template.name}</Badge>
                </div>
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex flex-wrap items-center gap-2">
              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#f6821f] px-4 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(246,130,31,0.35)] transition-all hover:bg-[#ff9436] hover:shadow-[0_4px_20px_rgba(246,130,31,0.5)]"
                >
                  Visit
                  <IconExternal className="h-3.5 w-3.5" />
                </a>
              )}
              {liveUrl && <CopyButton text={liveUrl} iconOnly />}
              <button
                type="button"
                id="redeploy-btn"
                onClick={handleRedeploy}
                disabled={redeploying}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/40 px-4 text-sm text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <IconRefresh className="h-4 w-4" />
                {redeploying ? "Triggering…" : "Re-deploy"}
              </button>
              <OverflowMenu
                onViewRepo={() => window.open(project.githubUrl, "_blank", "noreferrer")}
                onDelete={() => setShowDelete(true)}
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-end gap-0 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "border-[#f6821f] text-[#f6821f]"
                    : "border-transparent text-slate-500 hover:border-slate-700 hover:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          NOTICES
      ══════════════════════════════════════════════ */}
      {(error || notice) && (
        <div className="mx-auto max-w-screen-xl px-6 pt-5 sm:px-8">
          <div className="space-y-2">
            {error && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-700/40 bg-amber-950/25 px-4 py-3 text-sm text-amber-300">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="shrink-0 text-xs text-amber-400 hover:text-amber-200"
                >
                  Dismiss
                </button>
              </div>
            )}
            {notice && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-800/40 bg-sky-950/25 px-4 py-3 text-sm text-sky-300">
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="shrink-0 text-xs text-sky-400 hover:text-sky-200"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB CONTENT
      ══════════════════════════════════════════════ */}
      <div className="mx-auto max-w-screen-xl px-6 py-8 sm:px-8">
        {/* ── OVERVIEW TAB ── */}
        {activeTab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Left column */}
            <div className="min-w-0 space-y-5">
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  {
                    label: "Status",
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${meta.dotClass} ${
                            meta.pulse ? "animate-pulse" : ""
                          }`}
                        />
                        {meta.label}
                      </span>
                    ),
                  },
                  {
                    label: "Latest Run",
                    value: latest ? (
                      <a
                        href={latest.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm text-[#f6821f] hover:underline"
                      >
                        #{latest.runId}
                      </a>
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: "Started",
                    value: formatRelative(latest?.createdAt ?? null),
                  },
                  {
                    label: "Duration",
                    value: formatDuration(
                      latest?.createdAt ?? null,
                      latest?.updatedAt ?? null
                    ),
                  },
                  { label: "Total Runs", value: status?.totalRuns ?? 0 },
                ].map((stat, i) => (
                  <div
                    key={i}
                    className="group relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/60 px-4 py-3.5 transition-all hover:border-slate-700"
                    style={{
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                    }}
                  >
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                      {stat.label}
                    </p>
                    <div className="text-sm font-semibold text-slate-100">{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Live URL + meta */}
              <div
                className="rounded-xl border border-slate-800/80 bg-slate-900/60"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
              >
                <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                      Live URL
                    </p>
                    <div className="flex min-w-0 items-center gap-2">
                      {liveUrl ? (
                        <>
                          <code className="truncate font-mono text-sm text-[#f6821f]">
                            {liveUrl}
                          </code>
                          <CopyButton text={liveUrl} iconOnly />
                          <a
                            href={liveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500 transition-colors hover:text-[#f6821f]"
                          >
                            Open
                            <IconExternal className="h-3.5 w-3.5" />
                          </a>
                        </>
                      ) : (
                        <span className="text-sm text-slate-500">Not available</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <Meta
                      label="Commit"
                      value={
                        latest ? (
                          <a
                            href={`${project.githubUrl}/commit/${latest.headSha}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-300 hover:text-[#f6821f]"
                          >
                            {shortSha(latest.headSha)}
                          </a>
                        ) : (
                          "—"
                        )
                      }
                      copy={latest?.headSha ?? undefined}
                    />
                    <Meta
                      label="Platform"
                      value={
                        <span className="normal-case">
                          {project.type === "pages" ? "Pages" : "Workers"}
                        </span>
                      }
                    />
                    <Meta
                      label="Route"
                      value={
                        project.route ??
                        (project.type === "pages" ? "<name>.pages.dev" : "<name>.workers.dev")
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Template + Deploy Workflow */}
              <div className="grid gap-5 sm:grid-cols-2">
                <Card>
                  <CardHeader
                    icon={<IconBox className="h-4 w-4 text-slate-400" />}
                    title="Template"
                  />
                  <div className="px-5 py-4">
                    <dl className="space-y-3 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Name</dt>
                        <dd className="text-right text-slate-100">{template.name}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Source</dt>
                        <dd className="text-right capitalize text-slate-100">
                          {template.source === "c3" ? "create-cloudflare (live)" : "Built-in"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Runtime</dt>
                        <dd className="text-right text-slate-100">{template.stack}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Files</dt>
                        <dd className="text-right text-slate-100">{template.fileCount}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Requires route</dt>
                        <dd className="text-right text-slate-100">
                          {template.requiresRoute ? "Yes" : "No"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    icon={<IconRocket className="h-4 w-4 text-slate-400" />}
                    title="Deploy workflow"
                  />
                  <div className="px-5 py-4">
                    <dl className="space-y-3 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Setup</dt>
                        <dd className="max-w-[60%] truncate text-right font-mono text-xs text-slate-300">
                          {template.setup || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Build</dt>
                        <dd className="max-w-[60%] truncate text-right font-mono text-xs text-slate-300">
                          {template.buildCommand || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Deploy</dt>
                        <dd className="max-w-[60%] truncate text-right font-mono text-xs text-slate-300">
                          {template.deployCommand}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Triggered by</dt>
                        <dd className="text-right text-slate-100">
                          push to main + workflow_dispatch
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
                      Runs in GitHub Actions using{" "}
                      <code className="font-mono text-slate-400">CLOUDFLARE_API_TOKEN</code> and{" "}
                      <code className="font-mono text-slate-400">CLOUDFLARE_ACCOUNT_ID</code>{" "}
                      secrets set at launch time.
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            {/* Right sidebar */}
            <aside className="min-w-0 space-y-5">
              {/* ── Live Logs Panel ── */}
              <div
                className="overflow-hidden rounded-xl border border-slate-800/80"
                style={{ background: "#0a0f1e" }}
              >
                {/* Terminal chrome */}
                <div className="flex items-center justify-between border-b border-slate-800/70 px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                    </div>
                    <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
                      live tail
                    </span>
                  </div>
                  <IconTerminal className="h-3.5 w-3.5 text-slate-600" />
                </div>

                {/* Branch selector + Open button */}
                <div className="flex items-center gap-2 border-b border-slate-800/50 bg-slate-950/30 px-4 py-3">
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-slate-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <select
                    id="live-logs-branch-sidebar"
                    value={liveLogsBranch}
                    onChange={(e) => setLiveLogsBranch(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 font-mono text-xs text-slate-300 outline-none transition-colors hover:border-slate-700 focus:border-[#f6821f]/50"
                  >
                    {project.type === "worker" ? (
                      BRANCHES.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))
                    ) : (
                      <option value="main">main</option>
                    )}
                  </select>
                  {project.type === "worker" ? (
                    <Link
                      href={`/projects/${project.id}/live-logs`}
                      id="open-live-logs-btn"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f6821f] to-[#b85c10] px-3 py-1.5 text-xs font-bold text-white shadow-[0_2px_10px_rgba(246,130,31,0.3)] transition-all hover:from-[#ff9436] hover:shadow-[0_4px_16px_rgba(246,130,31,0.45)]"
                    >
                      <IconTerminal className="h-3.5 w-3.5" />
                      Live Logs
                    </Link>
                  ) : (
                    <span className="shrink-0 rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-600">
                      Workers only
                    </span>
                  )}
                </div>

                {/* Placeholder body */}
                <div className="px-4 py-4 font-mono text-xs text-slate-700">
                  {project.type === "worker" ? (
                    <p>
                      Select a branch and click{" "}
                      <span className="text-[#f6821f]">Live Logs</span> to open the full-screen
                      terminal ›
                    </p>
                  ) : (
                    <p>Live logs are not supported for Pages projects.</p>
                  )}
                </div>
              </div>

              {/* Preview Deployments */}
              <PreviewPanel
                projectId={project.id}
                projectName={project.name}
                projectType={project.type}
              />

              {/* Provisioning from code */}
              <ProvisionPanel projectId={project.id} projectType={project.type} />

              {/* Activity */}
              <ActivityPanel projectName={project.name} />
            </aside>
          </div>
        )}

        {/* ── DEPLOY HISTORY TAB ── */}
        {activeTab === "deploys" && (
          <Card>
            <CardHeader
              icon={<IconClock className="h-4 w-4 text-slate-400" />}
              title="Deploy history"
              count={runs.length}
              action={
                latest ? (
                  <a
                    href={latest.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#f6821f] hover:underline"
                  >
                    View workflow runs ↗
                  </a>
                ) : undefined
              }
            />
            {runs.length === 0 ? (
              <EmptyState
                icon={<IconRocket className="h-6 w-6" />}
                title="No deploys yet"
                hint="Push to main or hit Re-deploy to trigger the first workflow run."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-800/80 bg-slate-950/40 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Run</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Commit</th>
                      <th className="px-5 py-3">Started</th>
                      <th className="px-5 py-3">Duration</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {runs.map((run) => {
                      const rm = runMeta(run);
                      return (
                        <tr
                          key={run.runId}
                          className="transition-colors hover:bg-slate-950/50"
                        >
                          <td className="px-5 py-3">
                            <a
                              href={run.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-[#f6821f] hover:underline"
                            >
                              #{run.runId}
                            </a>
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${rm.className}`}
                            >
                              {rm.pulse && (
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                              )}
                              {rm.label}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <a
                              href={`${project.githubUrl}/commit/${run.headSha}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-slate-400 hover:text-[#f6821f]"
                            >
                              {shortSha(run.headSha)}
                            </a>
                          </td>
                          <td
                            className="px-5 py-3 text-slate-400"
                            title={formatDateTime(run.createdAt)}
                          >
                            {formatRelative(run.createdAt)}
                          </td>
                          <td className="px-5 py-3 text-slate-400">
                            {formatDuration(run.createdAt, run.updatedAt)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setLogsRun(run.runId)}
                              className="rounded-lg border border-slate-700/80 bg-slate-800/40 px-3 py-1 text-xs text-slate-300 transition-all hover:border-slate-600 hover:bg-slate-700/60 hover:text-white"
                            >
                              Logs
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── ENVIRONMENT TAB ── */}
        {activeTab === "env" && <EnvPanel projectId={project.id} />}

        {/* ── BINDINGS TAB ── */}
        {activeTab === "bindings" && <BindingsPanel projectId={project.id} />}

        {/* ── ACTIVITY TAB ── */}
        {activeTab === "activity" && <ActivityPanel projectName={project.name} />}
      </div>

      {/* ── Modals ── */}
      {logsRun !== null && (
        <LogsModal
          projectId={project.id}
          runId={logsRun}
          onClose={() => setLogsRun(null)}
        />
      )}

      {showDelete && (
        <DeleteProjectModal
          project={project}
          onClose={() => setShowDelete(false)}
          onDeleted={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
