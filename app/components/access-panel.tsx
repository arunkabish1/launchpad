"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectRole, SiteAccessMode } from "@/lib/types";
import { Card, CardHeader, CopyButton, IconKey } from "./ui";

interface AccessPanelProps {
  projectId: string;
  projectName: string;
  canManage: boolean;
}

interface AccessState {
  mode: SiteAccessMode;
  key: string | null;
  supported: boolean;
  unsupportedReason?: string;
}

const MODES: Array<{ value: SiteAccessMode; label: string; hint: string }> = [
  { value: "public", label: "Public", hint: "Anyone with the link can open the site." },
  { value: "org", label: "Organization", hint: "A shared access key your whole org can use." },
  {
    value: "members",
    label: "Members only",
    hint: "Shared access key shown to this project's members. Rotate to revoke.",
  },
];

export default function AccessPanel({
  projectId,
  projectName,
  canManage,
}: AccessPanelProps) {
  const [saved, setSaved] = useState<AccessState | null>(null);
  const [selected, setSelected] = useState<SiteAccessMode>("public");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/access`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load site access settings.");
        return;
      }
      const next: AccessState = {
        mode: data.mode ?? "public",
        key: data.key ?? null,
        supported: data.supported !== false,
        unsupportedReason: data.unsupportedReason,
      };
      setSaved(next);
      setSelected(next.mode);
      setError(null);
    } catch {
      setError("Failed to reach the Launchpad server.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const tick = async () => {
      await load();
    };
    void tick();
  }, [load]);

  async function save(nextMode: SiteAccessMode, rotate = false) {
    setSaving(true);
    setRotating(rotate);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/access`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: nextMode, rotate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update site access.");
        return;
      }
      const next: AccessState = {
        mode: data.mode ?? nextMode,
        key: data.key ?? null,
        supported: true,
      };
      setSaved(next);
      setSelected(next.mode);
      setNotice(
        rotate
          ? "A new access key was generated. It takes effect after the next deploy."
          : "Site access updated. It takes effect after the next auto-deploy (~1 minute)."
      );
    } catch {
      setError("Network error while updating site access.");
    } finally {
      setSaving(false);
      setRotating(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader icon={<IconKey className="h-4 w-4 text-slate-400" />} title="Site access" />
        <div className="px-5 py-4">
          <div className="h-4 w-48 animate-pulse rounded bg-slate-800" />
          <div className="mt-3 space-y-2">
            <div className="h-16 animate-pulse rounded-lg bg-slate-800/70" />
            <div className="h-16 animate-pulse rounded-lg bg-slate-800/70" />
          </div>
        </div>
      </Card>
    );
  }

  if (!saved || !saved.supported) {
    return (
      <Card>
        <CardHeader icon={<IconKey className="h-4 w-4 text-slate-400" />} title="Site access" />
        <div className="px-5 py-4">
          <p className="text-sm text-slate-400">
            {saved?.unsupportedReason ?? "Site access isn't supported for this template yet."}
          </p>
        </div>
      </Card>
    );
  }

  const showKey = saved.mode !== "public" && (canManage || saved.mode === "members");
  const pending = selected !== saved.mode;

  return (
    <div className="space-y-4">
      {(error || notice) && (
        <div className="space-y-2">
          {error && (
            <div className="rounded-xl border border-red-800/50 bg-red-950/25 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-sky-800/50 bg-sky-950/25 px-4 py-3 text-sm text-sky-300">
              {notice}
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader icon={<IconKey className="h-4 w-4 text-slate-400" />} title="Site access" />
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-400">
            Lock the deployed prototype with a shared access key. Visitors enter the key in the
            browser&apos;s login prompt; the deployed site handles the check, so preview branches
            are protected too. Takes effect on the next auto-deploy (~1 minute).
          </p>

          <div className="space-y-2">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  selected === m.value
                    ? "border-[#f6821f]/50 bg-[#f6821f]/5"
                    : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <input
                  type="radio"
                  name="site-access"
                  checked={selected === m.value}
                  disabled={!canManage || saving}
                  onChange={() => setSelected(m.value)}
                  className="mt-0.5 accent-[#f6821f]"
                />
                <span>
                  <span className="font-medium text-slate-200">{m.label}</span>
                  <span className="block text-xs text-slate-500">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </Card>

      {showKey && (
        <Card>
          <CardHeader icon={<IconKey className="h-4 w-4 text-slate-400" />} title="Access key" />
          <div className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <code className="min-w-0 truncate rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-[#f6821f]">
                {saved.key}
              </code>
              <CopyButton text={saved.key ?? ""} />
            </div>
            <p className="text-xs text-slate-500">
              Share this key with {saved.mode === "members" ? "project members" : "your organization"}.
              {saved.mode === "members" &&
                " Removing a member doesn't revoke them automatically — rotate to revoke."}
            </p>
          </div>
        </Card>
      )}

      {!canManage && saved.mode === "org" && (
        <p className="text-sm text-slate-500">
          This site uses an organization access key. Ask a project owner for the shared key.
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          {pending ? (
            <button
              onClick={() => save(selected)}
              disabled={saving}
              className="rounded-lg bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Applying…" : "Apply"}
            </button>
          ) : saved.mode === "public" ? (
            <button
              onClick={() => save("org")}
              disabled={saving}
              className="rounded-lg bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Protect this site
            </button>
          ) : (
            <>
              <button
                onClick={() => save(saved.mode, true)}
                disabled={saving || rotating}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-700/60 disabled:opacity-50"
              >
                {rotating ? "Rotating…" : "Rotate key"}
              </button>
              <button
                onClick={() => save("public")}
                disabled={saving}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-700/60 disabled:opacity-50"
              >
                Make public
              </button>
            </>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-600">
        Project name shown to visitors: <span className="text-slate-400">{projectName}</span>
      </p>
    </div>
  );
}
