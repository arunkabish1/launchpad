"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectStatusResult } from "@/lib/types";
import { getStatusMeta } from "./status-meta";
import DeleteProjectModal from "./delete-project-modal";
import BulkDeleteProjectsModal from "./bulk-delete-projects-modal";
import LogsModal from "./logs-modal";

export interface TableProject extends Project {
  liveUrl: string | null;
}

type Filter = "all" | "running" | "success" | "failed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Deploying" },
  { key: "success", label: "Deployed" },
  { key: "failed", label: "Failed" },
];

function groupOf(status: string | undefined): Filter {
  if (status === "running" || status === "queued") return "running";
  if (status === "success") return "success";
  if (status === "failure" || status === "cancelled") return "failed";
  return "all";
}

function ExternalIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

interface ProjectsTableProps {
  projects: TableProject[];
}

export default function ProjectsTable({ projects }: ProjectsTableProps) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusResult>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<TableProject | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [logsFor, setLogsFor] = useState<{ project: TableProject; runId: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/projects/statuses", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { statuses: Record<string, ProjectStatusResult> };
          setStatuses(data.statuses);
        }
      } catch {
        // keep last known statuses
      }
    };

    void tick();
    const interval = setInterval(tick, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: projects.length, running: 0, success: 0, failed: 0 };
    for (const p of projects) {
      const g = groupOf(statuses[p.id]?.status);
      if (g !== "all") c[g] += 1;
    }
    return c;
  }, [projects, statuses]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (filter === "all") return true;
      return groupOf(statuses[p.id]?.status) === filter;
    });
  }, [projects, statuses, filter, query]);

  const visibleIds = useMemo(() => new Set(visible.map((p) => p.id)), [visible]);
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const someVisibleSelected = visible.some((p) => selected.has(p.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkProjects = useMemo(() => projects.filter((p) => selected.has(p.id)), [projects, selected]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.key
                  ? "border-[#f6821f] bg-slate-800 text-white"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-slate-500">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500 sm:w-56"
        />
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f6821f]/30 bg-[#f6821f]/5 px-3 py-2">
          <span className="text-sm text-slate-300">
            <span className="font-semibold text-white">{selected.size}</span> selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => setBulkDeleting(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">
          {projects.length === 0 ? (
            <>
              No projects yet.{" "}
              <Link href="/" className="text-[#f6821f] hover:underline">
                Launch your first app
              </Link>
              .
            </>
          ) : (
            "No projects match your filters."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible projects"
                    className="h-4 w-4 rounded border-slate-600"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Template</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">URL</th>
                <th className="px-4 py-3 font-medium">Repository</th>
                <th className="px-4 py-3 font-medium">Launched</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visible.map((p) => {
                const status = statuses[p.id];
                const meta = getStatusMeta(status?.status);
                return (
                  <tr key={p.id} className="bg-slate-900/30 transition-colors hover:bg-slate-900/70">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        aria-label={`Select ${p.name}`}
                        className="h-4 w-4 rounded border-slate-600"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${p.id}`}
                        className="flex items-center gap-2 font-medium text-white hover:text-[#ff9436]"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass} ${
                            meta.pulse ? "animate-pulse" : ""
                          }`}
                        />
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">{p.templateName}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            p.type === "pages"
                              ? "bg-purple-500/15 text-purple-300"
                              : "bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {p.type}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                        title={status?.error}
                      >
                        {meta.pulse && (
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                        )}
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const url = status?.liveUrl ?? p.liveUrl;
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-slate-300 hover:text-[#ff9436]"
                          >
                            Visit
                            <ExternalIcon />
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={p.githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-300 hover:text-[#ff9436]"
                      >
                        {p.owner}/{p.repo}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {status?.latest && (
                          <button
                            type="button"
                            onClick={() => setLogsFor({ project: p, runId: status.latest!.runId })}
                            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                          >
                            Logs
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleting(p)}
                          className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-500 hover:border-red-700 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <DeleteProjectModal
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(deleting.id);
              return next;
            });
            setDeleting(null);
          }}
        />
      )}

      {bulkDeleting && (
        <BulkDeleteProjectsModal
          projects={bulkProjects}
          onClose={() => setBulkDeleting(false)}
          onCompleted={() => {
            setBulkDeleting(false);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}

      {logsFor && (
        <LogsModal
          projectId={logsFor.project.id}
          runId={logsFor.runId}
          onClose={() => setLogsFor(null)}
        />
      )}
    </div>
  );
}
