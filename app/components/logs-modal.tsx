"use client";

import { useEffect, useState } from "react";
import type { RunLog } from "@/lib/types";

interface LogsModalProps {
  projectId: string;
  runId: number;
  onClose: () => void;
}

export default function LogsModal({ projectId, runId, onClose }: LogsModalProps) {
  const [log, setLog] = useState<RunLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/logs?run=${runId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setLog(data as RunLog);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to fetch logs.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, runId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-950 shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-white">Deploy log — run #{runId}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && (
            <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {log?.steps && log.steps.length > 0 && (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-slate-500 uppercase">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Step</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {log.steps.map((s, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-4 font-mono text-slate-300">{s.name}</td>
                      <td className="py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            s.status === "completed" && s.conclusion === "success"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : s.status === "in_progress"
                              ? "bg-sky-500/15 text-sky-300"
                              : s.conclusion === "failure"
                              ? "bg-red-500/15 text-red-300"
                              : "bg-slate-700/40 text-slate-400"
                          }`}
                        >
                          {s.status === "completed" ? s.conclusion ?? "completed" : s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {log?.text ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300">
              {log.text}
            </pre>
          ) : (
            !error && <p className="text-sm text-slate-500">Loading logs…</p>
          )}
        </div>
      </div>
    </div>
  );
}
