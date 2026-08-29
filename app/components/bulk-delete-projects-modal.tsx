"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

interface BulkDeleteProjectsModalProps {
  projects: Project[];
  onClose: () => void;
  onCompleted: () => void;
}

interface BulkResult {
  deleted: number;
  failed: Array<{ name: string; error: string }>;
  warnings: string[];
}

export default function BulkDeleteProjectsModal({
  projects,
  onClose,
  onCompleted,
}: BulkDeleteProjectsModalProps) {
  const [deleteRepo, setDeleteRepo] = useState(true);
  const [deleteCloudflare, setDeleteCloudflare] = useState(true);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const count = projects.length;
  const confirmed = confirm.trim() === String(count);
  const busy = deleting || !confirmed;
  const hasAws = projects.some((p) => p.provider === "aws");
  const allAws = count > 0 && projects.every((p) => p.provider === "aws");
  const cloudLabel = allAws
    ? "Delete the AWS projects"
    : hasAws
      ? "Delete the Cloudflare and AWS projects"
      : "Delete the Cloudflare projects";

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: projects.map((p) => p.id),
          deleteRepo,
          deleteCloudflare,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete projects.");
        setDeleting(false);
        return;
      }
      setResult({
        deleted: data.deleted ?? 0,
        failed: data.failed ?? [],
        warnings: data.warnings ?? [],
      });
      setDeleting(false);
    } catch {
      setError("Network error while deleting.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-950 p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-base font-semibold text-white">
          Delete {count} project{count === 1 ? "" : "s"}?
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          This removes the projects from Launchpad and deletes the resources you select below. This
          cannot be undone.
        </p>

        <div className="mt-4 max-h-40 overflow-y-auto rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 py-1">
              <span className="truncate font-mono text-sm text-slate-200">{p.name}</span>
              <span className="shrink-0 font-mono text-xs text-slate-500">
                {p.owner}/{p.repo}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={deleteRepo}
              onChange={(e) => setDeleteRepo(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
            />
            Delete the GitHub repos
          </label>
          <label className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={deleteCloudflare}
              onChange={(e) => setDeleteCloudflare(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
            />
            {cloudLabel}
          </label>        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-300">
            Type <code className="font-mono">{count}</code> to confirm
          </label>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
            autoComplete="off"
            autoFocus
          />
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-3 space-y-2">
            {result.deleted > 0 && (
              <div className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                Deleted {result.deleted} project{result.deleted === 1 ? "" : "s"}.
              </div>
            )}
            {result.failed.length > 0 && (
              <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {result.failed.map((f) => (
                  <p key={f.name}>
                    <span className="font-semibold">{f.name}</span>: {f.error}
                  </p>
                ))}
              </div>
            )}
            {result.warnings.length > 0 && (
              <div className="rounded-md border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
                {result.warnings.join(" ")}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          {result ? (
            <button
              type="button"
              onClick={onCompleted}
              className="rounded-md bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-[#ff9436]"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={deleting}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : `Delete ${count}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
