"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry } from "@/lib/types";
import { formatRelative, formatDateTime } from "@/lib/format";
import { SkeletonList } from "./skeleton";
import { Card, CardHeader, IconActivity, IconRefresh } from "./ui";

interface ActivityPanelProps {
  projectName: string;
}

const ACTION_META: Record<AuditEntry["action"], { label: string; icon: string; color: string }> = {
  login: { label: "Signed in", icon: "●", color: "text-slate-400" },
  logout: { label: "Signed out", icon: "●", color: "text-slate-400" },
  launch: { label: "Project launched", icon: "▲", color: "text-emerald-300" },
  launch_failed: { label: "Launch failed", icon: "▲", color: "text-red-300" },
  redeploy: { label: "Re-deploy triggered", icon: "↻", color: "text-sky-300" },
  delete: { label: "Project deleted", icon: "✕", color: "text-red-300" },
  env_set: { label: "Env variable set", icon: "＋", color: "text-amber-300" },
  env_delete: { label: "Env variable removed", icon: "−", color: "text-amber-300" },
  binding_add: { label: "Binding added", icon: "＋", color: "text-purple-300" },
  binding_remove: { label: "Binding removed", icon: "−", color: "text-purple-300" },
  preview_enable: { label: "Previews enabled", icon: "◈", color: "text-emerald-300" },
  preview_disable: { label: "Previews disabled", icon: "◇", color: "text-emerald-300" },
  provision_enable: { label: "Provisioning enabled", icon: "◈", color: "text-sky-300" },
  provision_disable: { label: "Provisioning disabled", icon: "◇", color: "text-sky-300" },
  config_applied: { label: "Launch config applied", icon: "◈", color: "text-emerald-300" },
};

export default function ActivityPanel({ projectName }: ActivityPanelProps) {
  const [audits, setAudits] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/audit?project=${encodeURIComponent(projectName)}&limit=20`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) {
        setAudits(data.audits ?? []);
        setError(null);
      } else {
        setError(data.error ?? "Failed to load activity.");
      }
    } catch {
      setError("Failed to reach the Launchpad server.");
    }
  }, [projectName]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/audit?project=${encodeURIComponent(projectName)}&limit=20`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setAudits(data.audits ?? []);
          setError(null);
        } else {
          setError(data.error ?? "Failed to load activity.");
        }
      } catch {
        if (!cancelled) setError("Failed to reach the Launchpad server.");
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  return (
    <Card>
      <CardHeader
        icon={<IconActivity className="h-4 w-4 text-slate-400" />}
        title="Activity"
        count={audits ? audits.length : undefined}
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
        {audits === null ? (
          <SkeletonList rows={4} />
        ) : audits.length === 0 ? (
          <p className="text-sm text-slate-500">
            No activity recorded yet. Deploys, env changes, bindings, and preview toggles will show
            up here.
          </p>
        ) : (
          <ol className="relative ml-1.5 space-y-4 border-l border-slate-800/70 pl-4">
            {audits.map((a, i) => {
              const meta = ACTION_META[a.action] ?? {
                label: a.action,
                icon: "●",
                color: "text-slate-400",
              };
              const isLast = i === audits.length - 1;
              return (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[22px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 bg-slate-950 ${meta.color}`}
                    title={meta.label}
                  >
                    <span className="text-[11px] leading-none">{meta.icon}</span>
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm text-slate-200">{meta.label}</span>
                      <span className="text-xs text-slate-500">{a.actor}</span>
                    </div>
                    <time
                      className="text-xs text-slate-500"
                      title={formatDateTime(a.at)}
                      dateTime={a.at}
                    >
                      {formatRelative(a.at)}
                    </time>
                  </div>
                  {a.detail && <p className="mt-0.5 text-xs text-slate-500">{a.detail}</p>}
                  {!isLast && <span className="sr-only">—</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
