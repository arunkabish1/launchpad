"use client";

import { useEffect, useState } from "react";
import type { AuditEntry, ConfigStatus } from "@/lib/types";

interface SettingsPanelProps {
  initialStatus: ConfigStatus;
}

function StatusRow({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{hint}</div>
      </div>
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
          ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
        }`}
      >
        {ok ? "OK" : "Missing"}
      </span>
    </div>
  );
}

export default function SettingsPanel({ initialStatus }: SettingsPanelProps) {
  const [status, setStatus] = useState<ConfigStatus>(initialStatus);
  const [accountId, setAccountId] = useState(initialStatus.defaultAccountId);
  const [patEnvVar, setPatEnvVar] = useState("GITHUB_PAT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [audits, setAudits] = useState<AuditEntry[]>([]);

  useEffect(() => {
    fetch("/api/audit?limit=50")
      .then((r) => r.json())
      .then((data) => setAudits(data.audits ?? []))
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultAccountId: accountId, patEnvVar }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save config.");
        return;
      }
      setStatus(data.status);
      setSaved(true);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<{ label: string; ok: boolean; hint: string }> = [
    {
      label: "Admin password",
      ok: status.adminPasswordSet,
      hint: "LAUNCHPAD_ADMIN_PASSWORD — required to sign in.",
    },
    {
      label: "GitHub PAT env",
      ok: status.patEnvSet,
      hint: `${patEnvVar} (or launchpad.json patEnvVar) — used for GitHub operations.`,
    },
    {
      label: "Cloudflare API token",
      ok: status.cloudflareTokenSet,
      hint: "CLOUDFLARE_API_TOKEN — used for deploys and env vars.",
    },
    {
      label: "Cloudflare account ID",
      ok: Boolean(status.defaultAccountId),
      hint: status.defaultAccountId || "Set below or via CLOUDFLARE_ACCOUNT_ID.",
    },
    {
      label: "Secret key",
      ok: status.secretKeySet,
      hint: "LAUNCHPAD_SECRET — encrypts persisted GitHub tokens at rest.",
    },
    {
      label: "Target GitHub org",
      ok: Boolean(status.org),
      hint: status.org || "Not set — repos are created under the token owner's account.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Security status
        </h2>
        <div className="divide-y divide-slate-800/60">
          {rows.map((r) => (
            <StatusRow key={r.label} {...r} />
          ))}
        </div>
      </div>

      <form onSubmit={handleSave} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-400">
          Launchpad config
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Default Cloudflare account ID
            </label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="32-char Cloudflare account ID"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              GitHub PAT env var name
            </label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
              value={patEnvVar}
              onChange={(e) => setPatEnvVar(e.target.value)}
              placeholder="GITHUB_PAT"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
              Config saved.
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-[#f6821f] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save config"}
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Recent activity
          </h2>
          <span className="text-xs text-slate-500">{audits.length} entries</span>
        </div>
        {audits.length === 0 ? (
          <p className="text-sm text-slate-500">No activity recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {audits.map((a, i) => (
              <div key={i} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">
                    <span className="font-medium">{a.actor}</span>{" "}
                    <span className="text-slate-500">{a.action}</span>
                    <span className="ml-1 text-slate-400">{a.project}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{a.detail}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      a.outcome === "ok"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {a.outcome}
                  </span>
                  <span className="text-[11px] text-slate-500">{new Date(a.at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
