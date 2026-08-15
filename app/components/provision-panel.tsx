"use client";

import { useEffect, useState } from "react";
import type { DeployTarget } from "@/lib/types";
import { Badge, Card, CardHeader } from "./ui";

interface ProvisionPanelProps {
  projectId: string;
  projectType: DeployTarget;
}

export default function ProvisionPanel({ projectId, projectType }: ProvisionPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/provision`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setEnabled(Boolean(data.enabled));
          setError(null);
        } else {
          setError(data.error ?? "Failed to load provisioning settings.");
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

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/provision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update provisioning settings.");
        return;
      }
      setEnabled(next);
      setNotice(
        next
          ? "Provisioning from code enabled. Edit wrangler.toml (or .launchpad/env-values.enc) and push to main to provision resources."
          : "Provisioning from code disabled. The provision step and script were removed from the repo."
      );
    } catch {
      setError("Network error while updating provisioning settings.");
    } finally {
      setBusy(false);
    }
  }

  if (projectType !== "worker") {
    return (
      <Card>
        <CardHeader title="Provisioning from code" />
        <p className="px-5 pb-5 text-sm text-slate-500">
          Provisioning from pushed code is not supported for Pages projects.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Provisioning from code"
        action={
          <Badge
            className={
              enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/30 text-slate-400"
            }
          >
            {enabled ? "Enabled" : "Disabled"}
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

      <div className="px-5 py-4">
        {!loaded ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              Provision resources by editing files and pushing, without using Launchpad. KV, D1 and
              R2 bindings without IDs are created automatically on <code className="font-mono text-xs">wrangler deploy</code>.
              AI Search instances and Turnstile widgets are created by a provision step before deploy.
            </p>

            <button
              type="button"
              onClick={() => toggle(!enabled)}
              disabled={busy}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                enabled
                  ? "border border-slate-700 text-slate-300 hover:border-red-700 hover:text-red-300"
                  : "bg-[#f6821f] text-slate-950 hover:bg-[#ff9436]"
              }`}
            >
              {busy ? "…" : enabled ? "Disable" : "Enable provisioning"}
            </button>
          </>
        )}
      </div>

      <div className="mx-5 mb-5 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-500">
        <span className="text-slate-400">[[kv_namespaces]]</span> binding = &quot;CACHE&quot;{" "}
        <span className="text-slate-600"># no id → created on push</span>
      </div>
    </Card>
  );
}
