"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";

interface DeleteProjectModalProps {
  project: Project;
  onClose: () => void;
  onDeleted?: () => void;
}

export default function DeleteProjectModal({ project, onClose, onDeleted }: DeleteProjectModalProps) {
  const router = useRouter();
  const [deleteRepo, setDeleteRepo] = useState(true);
  const [deleteCloudflare, setDeleteCloudflare] = useState(true);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirm.trim() === project.name;
  const busy = deleting || !confirmed;

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteRepo, deleteCloudflare }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete project.");
        setDeleting(false);
        return;
      }
      onClose();
      if (onDeleted) onDeleted();
      else router.push("/projects");
      router.refresh();
    } catch {
      setError("Network error while deleting.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-base font-semibold text-white">Delete {project.name}?</h2>
        <p className="mt-1 text-sm text-slate-400">
          This removes the project from Launchpad and deletes the resources you select below.
          This cannot be undone.
        </p>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={deleteRepo}
              onChange={(e) => setDeleteRepo(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
            />
            Delete the GitHub repo{" "}
            <code className="font-mono text-xs text-slate-400">
              {project.owner}/{project.repo}
            </code>
          </label>
          <label className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={deleteCloudflare}
              onChange={(e) => setDeleteCloudflare(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
            />
            Delete the Cloudflare {project.type} project
          </label>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-300">
            Type <code className="font-mono">{project.name}</code> to confirm
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

        <div className="mt-5 flex justify-end gap-3">
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
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
