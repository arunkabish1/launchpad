"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Binding, BindingResource, BindingType } from "@/lib/types";
import { SkeletonList } from "./skeleton";
import { Card, CardHeader, IconBox, IconRefresh } from "./ui";

interface BindingsPanelProps {
  projectId: string;
}

const TYPE_OPTIONS: Array<{ value: BindingType; label: string }> = [
  { value: "kv", label: "KV" },
  { value: "d1", label: "D1" },
  { value: "r2", label: "R2" },
  { value: "turnstile", label: "Turnstile" },
  { value: "ai_search", label: "AI Search" },
];

const TYPE_HINTS: Record<BindingType, string> = {
  kv: "Workers KV namespace",
  d1: "D1 SQL database",
  r2: "R2 bucket",
  turnstile: "CAPTCHA widget",
  ai_search: "Searchable instance",
};

const TYPE_BADGE: Record<BindingType, string> = {
  kv: "bg-sky-500/15 text-sky-300",
  d1: "bg-emerald-500/15 text-emerald-300",
  r2: "bg-purple-500/15 text-purple-300",
  turnstile: "bg-teal-500/15 text-teal-300",
  ai_search: "bg-indigo-500/15 text-indigo-300",
};

const RESOURCE_NOUN: Record<BindingType, string> = {
  kv: "namespace",
  d1: "database",
  r2: "bucket",
  turnstile: "widget",
  ai_search: "instance",
};

export default function BindingsPanel({ projectId }: BindingsPanelProps) {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [resources, setResources] = useState<BindingResource[]>([]);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<BindingType>("kv");
  const [name, setName] = useState("");
  const [useExisting, setUseExisting] = useState(false);
  const [resourceName, setResourceName] = useState("");
  const [existingName, setExistingName] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/bindings`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setBindings(data.bindings ?? []);
        setResources(data.resources ?? []);
        setConfigPath(data.configPath ?? null);
        setError(null);
      } else {
        setError(data.error ?? "Failed to load bindings.");
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
        const res = await fetch(`/api/projects/${projectId}/bindings`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setBindings(data.bindings ?? []);
          setResources(data.resources ?? []);
          setConfigPath(data.configPath ?? null);
          setError(null);
        } else {
          setError(data.error ?? "Failed to load bindings.");
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

  const typeResources = useMemo(
    () => resources.filter((r) => r.type === type),
    [resources, type]
  );

  function switchType(next: BindingType) {
    setType(next);
    setExistingName("");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/bindings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          name,
          resource: useExisting ? existingName : resourceName,
          domain: type === "turnstile" && !useExisting ? domain : undefined,
          existing: useExisting,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add binding.");
        return;
      }
      setName("");
      setResourceName("");
      setExistingName("");
      setDomain("");
      setUseExisting(false);
      setNotice(data.warning ?? "Binding added. A redeploy has been triggered in the repo.");
      await load();
    } catch {
      setError("Network error while adding binding.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(binding: Binding) {
    setDeleting(binding.name);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/bindings/${binding.name}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to remove binding.");
        return;
      }
      setNotice("Binding removed. A redeploy has been triggered in the repo.");
      await load();
    } catch {
      setError("Network error while removing binding.");
    } finally {
      setDeleting(null);
    }
  }

  const addDisabled =
    saving || !name.trim() || (useExisting ? !existingName : !resourceName.trim());

  return (
    <Card>
      <CardHeader
        icon={<IconBox className="h-4 w-4 text-slate-400" />}
        title="Cloudflare bindings"
        count={loaded ? bindings.length : undefined}
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

      {notice && (
        <div className="mx-5 mt-4 rounded-md border border-sky-800/50 bg-sky-950/30 px-3 py-2 text-xs text-sky-300">
          {notice}
        </div>
      )}

      <div className="px-5 py-4">
        {!loaded ? (
          <SkeletonList rows={2} />
        ) : configPath === null ? (
          <p className="text-sm text-slate-500">
            No wrangler config file found in this repo — bindings aren&apos;t supported for this
            project type.
          </p>
        ) : bindings.length === 0 ? (
          <p className="text-sm text-slate-500">No bindings configured yet.</p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {bindings.map((b) => (
              <div key={b.name} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_BADGE[b.type]}`}>
                    {b.type}
                  </span>
                  <span className="truncate font-mono text-sm text-slate-200">{b.name}</span>
                  <span className="truncate font-mono text-xs text-slate-500">{b.resource}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(b)}
                  disabled={deleting === b.name}
                  className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:border-red-700 hover:text-red-300 disabled:opacity-60"
                >
                  {deleting === b.name ? "…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {configPath !== null && (
        <form onSubmit={handleAdd} className="space-y-3 border-t border-slate-800/60 px-5 pt-4 pb-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Type</label>
              <select
                value={type}
                onChange={(e) => switchType(e.target.value as BindingType)}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {TYPE_HINTS[t.value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Binding name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MY_BUCKET"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-slate-500"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Resource</label>
              {useExisting ? (
                <select
                  value={existingName}
                  onChange={(e) => setExistingName(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
                >
                  <option value="">Select…</option>
                  {typeResources.map((r) => (
                    <option
                      key={`${r.type}-${r.id ?? r.name}`}
                      value={r.type === "turnstile" || r.type === "ai_search" ? (r.id ?? r.name) : r.name}
                    >
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={resourceName}
                  onChange={(e) => setResourceName(e.target.value)}
                  placeholder={
                    type === "r2"
                      ? "my-bucket-name"
                      : type === "turnstile"
                        ? "my-widget-name"
                        : type === "ai_search"
                          ? "my-search-index"
                          : "my-resource"
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-slate-500"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              )}
            </div>
          </div>

          {type === "turnstile" && !useExisting && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Domain <span className="text-slate-500">(optional)</span>
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-slate-500"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Defaults to the project&apos;s live URL host. Preview branches get their own
                per-branch widget automatically.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={useExisting}
                onChange={(e) => setUseExisting(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600"
              />
              Use an existing {RESOURCE_NOUN[type]}
            </label>
            <div className="flex items-center gap-3">
              {type === "d1" && (
                <span className="text-[11px] text-slate-500">New databases use the default region.</span>
              )}
              <button
                type="submit"
                disabled={addDisabled}
                className="rounded-md bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Adding…" : "Add binding"}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="mx-5 mb-5 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
        KV/D1/R2/AI Search bindings are written to{" "}
        <code className="font-mono text-slate-400">{configPath ?? "wrangler config"}</code> in the
        repo and applied by the next deploy. Turnstile widgets are delivered as env vars
        (<code className="font-mono text-slate-400">*_SITE_KEY</code> /{" "}
        <code className="font-mono text-slate-400">*_SECRET_KEY</code>) and preview branches
        receive their own widget. Removing a Turnstile widget or AI Search instance also removes
        the underlying account resource.
      </div>

      <div className="mx-5 mb-5 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
        You can also provision from pushed code: add a KV/D1/R2 binding without an ID to{" "}
        <code className="font-mono text-slate-400">wrangler.toml</code> and push — it is created
        automatically on deploy. AI Search and Turnstile are provisioned by the &quot;Provision
        resources&quot; step when{" "}
        <code className="font-mono text-slate-400">provisioning from code</code> is enabled.
      </div>
    </Card>
  );
}
