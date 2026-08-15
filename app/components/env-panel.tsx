"use client";

import { useCallback, useEffect, useState } from "react";
import type { EnvVar } from "@/lib/types";
import { SkeletonList } from "./skeleton";
import { Card, CardHeader, IconKey, IconRefresh } from "./ui";

interface EnvPanelProps {
  projectId: string;
}

export default function EnvPanel({ projectId }: EnvPanelProps) {
  const [env, setEnv] = useState<EnvVar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isSecret, setIsSecret] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/env`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setEnv(data.env ?? []);
        setError(null);
      } else {
        setError(data.error ?? "Failed to load env vars.");
      }
    } catch {
      setError("Failed to reach the Launchpad server.");
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/env`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setEnv(data.env ?? []);
          setError(null);
        } else {
          setError(data.error ?? "Failed to load env vars.");
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
  }, [projectId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/env`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value, secret: isSecret }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to set env var.");
        return;
      }
      setKey("");
      setValue("");
      await load();
    } catch {
      setError("Network error while saving env var.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(k: string) {
    setDeletingKey(k);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/env/${k}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete env var.");
        return;
      }
      await load();
    } catch {
      setError("Network error while deleting env var.");
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<IconKey className="h-4 w-4 text-slate-400" />}
        title="Environment variables"
        count={loaded ? env.length : undefined}
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-xs text-[#ff9436] hover:underline"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      <div className="px-5 py-4">
        {!loaded ? (
          <SkeletonList rows={3} />
        ) : env.length === 0 && !error ? (
          <p className="text-sm text-slate-500">
            No environment variables set. These are injected into the worker at runtime.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {env.map((v) => (
              <div key={v.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-sm text-slate-200">{v.key}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      v.kind === "secret"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-sky-500/15 text-sky-300"
                    }`}
                  >
                    {v.kind}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(v.key)}
                  disabled={deletingKey === v.key}
                  className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:border-red-700 hover:text-red-300 disabled:opacity-60"
                >
                  {deletingKey === v.key ? "…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleAdd} className="mt-4 space-y-3 border-t border-slate-800/60 px-5 pt-4 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Key</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="MY_KEY"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-slate-500"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Value</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="my-value"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-slate-500"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={isSecret}
              onChange={(e) => setIsSecret(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600"
            />
            Encrypt as a secret (not visible in the dashboard)
          </label>
          <button
            type="submit"
            disabled={saving || !key.trim() || !value.trim()}
            className="rounded-md bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add var"}
          </button>
        </div>
      </form>
    </Card>
  );
}
