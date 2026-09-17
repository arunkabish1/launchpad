"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TemplateCategory, TemplateInfo, ImportAnalysis, LaunchConfig } from "@/lib/types";
import { CATEGORIES } from "@/lib/template-meta";

interface LaunchPadProps {
  templates: TemplateInfo[];
  envPatSet: boolean;
  envTokenSet: boolean;
  defaultAccountId: string;
  envAwsAccessKeySet: boolean;
  envAwsSecretKeySet: boolean;
  org?: string;
}

type Step = 1 | 2 | 3;

type LaunchEnvVarRow = { key: string; value: string; kind: "secret" | "text" };
type LaunchBindingRow = { type: "kv" | "d1" | "r2" | "ai_search"; name: string; resource: string };

const BINDING_TYPE_OPTIONS: Array<{ value: LaunchBindingRow["type"]; label: string }> = [
  { value: "kv", label: "KV" },
  { value: "d1", label: "D1" },
  { value: "r2", label: "R2" },
  { value: "ai_search", label: "AI Search" },
];

const platformLabel = (t: TemplateInfo) => {
  if (t.provider === "aws") return t.type === "amplify" ? "AWS Amplify" : "AWS Lambda";
  return t.type === "pages" ? "Cloudflare Pages" : "Cloudflare Workers";
};

export default function LaunchPad({ templates, envPatSet, envTokenSet, defaultAccountId, envAwsAccessKeySet, envAwsSecretKeySet, org }: LaunchPadProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const deepLinkedId = searchParams.get("template");
  const deepLinked = templates.find((t) => t.id === deepLinkedId) ?? null;

  const [step, setStep] = useState<Step>(deepLinked ? 3 : 1);
  const [category, setCategory] = useState<TemplateCategory | null>(deepLinked?.category ?? null);
  const [selected, setSelected] = useState<TemplateInfo | null>(deepLinked);
  const [details, setDetails] = useState<TemplateInfo | null>(null);

  const [importMode, setImportMode] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importPat, setImportPat] = useState("");
  const [importProjectName, setImportProjectName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [importEnvValues, setImportEnvValues] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [route, setRoute] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [githubPat, setGithubPat] = useState("");
  const [cloudflareToken, setCloudflareToken] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [awsAccessKey, setAwsAccessKey] = useState("");
  const [awsSecretKey, setAwsSecretKey] = useState("");
  const [awsRegion, setAwsRegion] = useState("");

  const [launchEnvVars, setLaunchEnvVars] = useState<LaunchEnvVarRow[]>([]);
  const [launchBindings, setLaunchBindings] = useState<LaunchBindingRow[]>([]);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [provisionEnabled, setProvisionEnabled] = useState(true);

  const isAmplify = selected?.provider === "aws" && selected?.type === "amplify";

  useEffect(() => {
    if (!details) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetails(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [details]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryTemplates = category
    ? templates.filter((t) => t.category === category)
    : [];

  function resetToCategory(cat: TemplateCategory) {
    setCategory(cat);
    setSelected(null);
    setStep(2);
  }

  async function handleLaunch() {
    setError(null);

    if (!selected) {
      setError("Select a template first.");
      return;
    }
    if (!projectName.trim()) {
      setError("Enter a project name.");
      return;
    }
    if (!envPatSet && !githubPat.trim()) {
      setError("Enter a GitHub Personal Access Token (or set GITHUB_PAT in .env).");
      return;
    }
    if (selected.provider === "aws") {
      if (!awsAccessKey.trim() && !envAwsAccessKeySet) {
        setError("Enter your AWS Access Key ID (or set it in .env).");
        return;
      }
      if (!awsSecretKey.trim() && !envAwsSecretKeySet) {
        setError("Enter your AWS Secret Access Key (or set it in .env).");
        return;
      }
    } else {
      if (!cloudflareToken.trim() && !envTokenSet) {
        setError("Enter a Cloudflare API token.");
        return;
      }
      if (!accountId.trim() && !defaultAccountId) {
        setError("Enter your Cloudflare account ID.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: {
        templateId: string;
        projectName: string;
        private: boolean;
        githubPat?: string;
        cloudflareToken?: string;
        accountId?: string;
        awsAccessKey?: string;
        awsSecretKey?: string;
        awsRegion?: string;
        config?: LaunchConfig;
      } = {
        templateId: selected.id,
        projectName: projectName.trim(),
        private: isPrivate,
      };

      if (githubPat.trim()) payload.githubPat = githubPat.trim();
      if (selected.provider === "aws") {
        if (awsAccessKey.trim()) payload.awsAccessKey = awsAccessKey.trim();
        if (awsSecretKey.trim()) payload.awsSecretKey = awsSecretKey.trim();
        if (awsRegion.trim()) payload.awsRegion = awsRegion.trim();
      } else {
        if (cloudflareToken.trim()) payload.cloudflareToken = cloudflareToken.trim();
        if (accountId.trim()) payload.accountId = accountId.trim();
        payload.config = {
          envVars: launchEnvVars
            .filter((v) => v.key.trim())
            .map((v) => ({ key: v.key.trim(), value: v.value, kind: v.kind })),
          bindings: launchBindings
            .filter((b) => b.name.trim() && b.resource.trim())
            .map((b) => ({ type: b.type, name: b.name.trim(), resource: b.resource.trim() })),
          previewEnabled,
          provisionEnabled,
        };
      }

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to launch project.");
        setSubmitting(false);
        return;
      }
      router.push("/projects");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleAnalyze() {
    setError(null);
    if (!importUrl.trim()) {
      setError("Paste a GitHub repository URL first.");
      return;
    }
    if (!envPatSet && !importPat.trim()) {
      setError("Enter a GitHub Personal Access Token (or set GITHUB_PAT in .env).");
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/import/analyse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim(), githubPat: importPat.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
        setAnalyzing(false);
        return;
      }
      setAnalysis(data.analysis);
      const evs: Record<string, string> = {};
      for (const v of data.analysis.plan?.envVars ?? []) evs[v.key] = "";
      setImportEnvValues(evs);
      setAnalyzing(false);
    } catch {
      setError("Network error. Please try again.");
      setAnalyzing(false);
    }
  }

  async function handleImportDeploy() {
    setError(null);
    if (!analysis?.plan) return;
    if (!importProjectName.trim()) {
      setError("Enter a project name.");
      return;
    }
    if (!envPatSet && !importPat.trim()) {
      setError("Enter a GitHub Personal Access Token (or set GITHUB_PAT in .env).");
      return;
    }
    if (!cloudflareToken.trim() && !envTokenSet) {
      setError("Enter a Cloudflare API token.");
      return;
    }
    if (!accountId.trim() && !defaultAccountId) {
      setError("Enter your Cloudflare account ID.");
      return;
    }
    setImporting(true);
    try {
      const payload: {
        url: string;
        projectName: string;
        plan: ImportAnalysis["plan"];
        githubPat?: string;
        cloudflareToken?: string;
        accountId?: string;
        envValues: Record<string, string>;
      } = {
        url: importUrl.trim(),
        projectName: importProjectName.trim(),
        plan: analysis.plan,
        envValues: importEnvValues,
      };
      if (importPat.trim()) payload.githubPat = importPat.trim();
      if (cloudflareToken.trim()) payload.cloudflareToken = cloudflareToken.trim();
      if (accountId.trim()) payload.accountId = accountId.trim();
      const res = await fetch("/api/import/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Deploy failed.");
        setImporting(false);
        return;
      }
      router.push("/projects");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setImporting(false);
    }
  }

  const importBlockers = analysis?.detection?.blockers ?? [];

  if (importMode) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Deploy an existing project</h2>
            <p className="text-sm text-slate-400">
              Paste a GitHub repository URL and we&rsquo;ll deploy it to Cloudflare for you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setImportMode(false);
              setAnalysis(null);
              setError(null);
              setStep(1);
            }}
            className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
          >
            ← Back
          </button>
        </div>

        {!analysis && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                GitHub repository URL
              </label>
              <input
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                The repo stays in place; Launchpad adds a deploy workflow and Cloudflare config to
                it.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                GitHub Personal Access Token
              </label>
              <input
                type="password"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                value={importPat}
                onChange={(e) => setImportPat(e.target.value)}
                placeholder={envPatSet ? "Set via .env (optional here)" : "ghp_... (scopes: repo, workflow)"}
                autoComplete="off"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing}
              className="w-full rounded-md bg-[#f6821f] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {analyzing ? "Analyzing..." : "Analyze and plan the deploy"}
            </button>
          </div>
        )}

        {analysis && !analysis.plan && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <span className="text-sm font-semibold text-amber-300">Hmm, this one needs a hand</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-300">
              <p className="mb-2">{analysis.guidedFix?.reason}</p>
              {importBlockers.length > 0 && (
                <p className="mb-2 text-xs text-slate-400">
                  Detected: <span className="text-slate-300">{importBlockers.join(", ")}</span>
                </p>
              )}
              <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
                <span className="mb-1 block text-xs font-medium text-slate-400">
                  Ask your AI tool to do this
                </span>
                <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-200">
                  {analysis.guidedFix?.instruction}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setAnalysis(null);
                setError(null);
              }}
              className="w-full rounded-md border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Analyze a different repo
            </button>
          </div>
        )}

        {analysis && analysis.plan && (
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                  Ready to deploy
                </span>
                <span className="text-sm text-slate-400">
                  {analysis.detection.framework ?? "App"} ·{" "}
                  {analysis.plan.deployKind === "pages" ? "Cloudflare Pages" : "Cloudflare Workers"}
                </span>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
                <span className="mb-2 block text-xs font-medium text-slate-300">
                  What Launchpad will do
                </span>
                <p className="text-sm text-slate-200">{analysis.plan.summary}</p>
                {analysis.plan.notes.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">
                    {analysis.plan.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Build command</dt>
                    <dd className="truncate font-mono text-slate-200">{analysis.plan.buildCommand || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Deploy command</dt>
                    <dd className="truncate font-mono text-slate-200">{analysis.plan.deployCommand}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Package manager</dt>
                    <dd className="text-slate-200">{analysis.plan.packageManager ?? "—"}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Project name</label>
                <input
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                  value={importProjectName}
                  onChange={(e) => setImportProjectName(e.target.value)}
                  placeholder={analysis.repoTitle ?? "my-app"}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Used as the Cloudflare project/worker name.
                </p>
              </div>

              {analysis.plan.envVars.length > 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
                  <span className="mb-2 block text-xs font-medium text-slate-300">
                    Environment values
                  </span>
                  <p className="mb-2 text-[11px] text-slate-500">
                    Optional. These are stored as GitHub repo secrets and used by the deploy.
                  </p>
                  <div className="space-y-2">
                    {analysis.plan.envVars.map((v) => (
                      <div key={v.key}>
                        <label className="mb-0.5 block text-[11px] font-medium text-slate-400">
                          {v.key}
                        </label>
                        <input
                          type={v.kind === "secret" ? "password" : "text"}
                          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                          value={importEnvValues[v.key] ?? ""}
                          onChange={(e) =>
                            setImportEnvValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                          }
                          placeholder={v.kind === "secret" ? "Leave blank to keep empty" : ""}
                          autoComplete="off"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleImportDeploy}
                disabled={importing}
                className="w-full rounded-md bg-[#f6821f] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? "Deploying..." : "Looks good, deploy →"}
              </button>
            </div>

            <div className="lg:sticky lg:top-8 lg:self-start">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
                  Repo summary
                </h2>
                <dl className="space-y-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Repo</dt>
                    <dd className="truncate text-slate-200" title={importUrl}>
                      {analysis.repoTitle}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Branch</dt>
                    <dd className="text-slate-200">{analysis.defaultBranch}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Files analyzed</dt>
                    <dd className="text-slate-200">{analysis.files.length}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Deploy target</dt>
                    <dd className="text-slate-200">
                      {analysis.plan.deployKind === "pages" ? "Cloudflare Pages" : "Cloudflare Workers"}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const templateStack = (t: TemplateInfo) => {
    const parts = [];
    if (t.deploy?.runtime) parts.push(t.deploy.runtime);
    if (t.buildCommand) parts.push("build: " + t.buildCommand);
    return parts.join(", ") || "—";
  };

  if (step === 1) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold text-white">Launch a new app</h1>
        <p className="text-slate-400">Choose a language and framework to get started.</p>
        <div
          className="flex flex-col rounded-xl border border-[#f6821f]/40 bg-[#f6821f]/5 p-4 transition-colors hover:border-[#f6821f] cursor-pointer"
          onClick={() => {
            setImportMode(true);
            setError(null);
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white">Deploy an existing project</span>
            <span className="shrink-0 rounded-full bg-[#f6821f]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#f6821f]">
              New
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Paste a GitHub URL from an app you (or your AI) already built. Launchpad analyzes it and
            deploys it to Cloudflare — with nothing to configure.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              onClick={() => resetToCategory(cat.id)}
              className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700 cursor-pointer"
            >
              <span className="text-sm font-semibold text-white">{cat.label}</span>
              <p className="mt-1 text-xs text-slate-400">{cat.description}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <>
        <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-white">Choose a template</h2>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
          >
            ← Change language
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categoryTemplates.map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setSelected(t);
                setStep(3);
              }}
              className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold text-white">{t.name}</span>
                <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {platformLabel(t)}
                </span>
              </div>
              <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-400">{t.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {t.source === "c3" && (
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
                    create-cloudflare
                  </span>
                )}
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                  {CATEGORIES.find((c) => c.id === t.category)?.label ?? t.category}
                </span>
                <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {t.deploy?.runtime ?? "—"}
                </span>
                {t.buildCommand && (
                  <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    build
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetails(t);
                }}
                className="mt-4 w-full rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-[#f6821f] hover:text-[#f6821f]"
              >
                View details
              </button>
            </div>
          ))}
        </div>
      </div>

        {details && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setDetails(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`${details.name} details`}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-white">{details.name}</h2>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {platformLabel(details)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{details.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetails(null)}
                  aria-label="Close"
                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
                  <span className="mb-2 block text-xs font-medium text-slate-300">Deployment</span>
                  <dl className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Platform</dt>
                      <dd className="text-right text-slate-200">{platformLabel(details)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Source</dt>
                      <dd className="text-right text-slate-200">
                        {details.source === "c3" ? "create-cloudflare (live)" : "Built-in"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Runtime</dt>
                      <dd className="text-right text-slate-200">{templateStack(details)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Setup</dt>
                      <dd className="truncate font-mono text-slate-200" title={details.deploy?.setup}>
                        {details.deploy?.setup ?? (details.buildCommand || "—")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Deploy command</dt>
                      <dd className="truncate font-mono text-slate-200" title={details.deploy?.command ?? details.deployCommand}>
                        {details.deploy?.command ?? details.deployCommand}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Files</dt>
                      <dd className="text-slate-200">{details.files.length}</dd>
                    </div>
                  </dl>
                </div>

                {details.c3 && (
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-slate-300">
                      create-cloudflare command
                    </span>
                    <code className="block rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
                      npm create cloudflare@latest -- {details.c3.args.join(" ")}
                    </code>
                  </div>
                )}

                <div>
                  <span className="mb-1.5 block text-xs font-medium text-slate-300">
                    Files in template ({details.files.length})
                  </span>
                  <ul className="grid gap-x-6 gap-y-1 font-mono text-[11px] text-slate-400 sm:grid-cols-2">
                    {details.files.map((f) => (
                      <li key={f} className="truncate">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex gap-2 border-t border-slate-800 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setDetails(null)}
                  className="rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(details);
                    setDetails(null);
                    setStep(3);
                  }}
                  className="flex-1 rounded-md bg-[#f6821f] px-4 py-2 text-center text-xs font-semibold text-slate-950 transition-colors hover:bg-[#ff9436]"
                >
                  Use this template →
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (step === 3 && selected) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
                Deployment options
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Options below are tailored to{" "}
                <span className="font-medium text-slate-300">{selected.name}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
            >
              ← Change template
            </button>
          </div>

          {org && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              <svg
                className="h-4 w-4 shrink-0 text-[#f6821f]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 21v-4h6v4" />
                <path d="M9 11h6" />
              </svg>
              Target: <span className="font-semibold text-white">{org}</span> — the repo and its
              deploy secrets will be created under this GitHub organization.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Project name</label>
              <input
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-api"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Lowercase letters, numbers, hyphens. Used as the repo name and Cloudflare project
                name.
              </p>
            </div>

            {selected.requiresRoute && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Route</label>
                <input
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  placeholder="*.example.com/*"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  This template is deployed to a custom domain route.
                </p>
              </div>
            )}

            <div>
              <span className="mb-1 block text-xs font-medium text-slate-300">Visibility</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    isPrivate
                      ? "border-[#f6821f] bg-slate-800 text-white"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  Private
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    !isPrivate
                      ? "border-[#f6821f] bg-slate-800 text-white"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  Public
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
              <span className="mb-2 block text-xs font-medium text-slate-300">
                Deployment profile
              </span>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Platform</dt>
                  <dd className="text-right text-slate-200">{platformLabel(selected)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Source</dt>
                  <dd className="text-right text-slate-200">
                    {selected.source === "c3" ? "create-cloudflare (live)" : "Built-in"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Runtime</dt>
                  <dd className="text-right text-slate-200">{templateStack(selected)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Setup</dt>
                  <dd className="truncate font-mono text-slate-200" title={selected.deploy?.setup}>
                    {selected.deploy?.setup ?? (selected.buildCommand || "—")}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Deploy command</dt>
                  <dd
                    className="truncate font-mono text-slate-200"
                    title={selected.deploy?.command ?? selected.deployCommand}
                  >
                    {selected.deploy?.command ?? selected.deployCommand}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Files</dt>
                  <dd className="text-slate-200">{selected.files.length}</dd>
                </div>
                {selected.requiresRoute && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Requires route</dt>
                    <dd className="text-amber-300">Yes</dd>
                  </div>
                )}
              </dl>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                GitHub Personal Access Token
              </label>
              <input
                type="password"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                value={githubPat}
                onChange={(e) => setGithubPat(e.target.value)}
                placeholder={envPatSet ? "Set via .env (optional here)" : "ghp_... (scopes: repo, workflow)"}
                autoComplete="off"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {envPatSet
                  ? "A token from .env is available; this field is optional."
                  : "Needs repo + workflow scopes. Used only to create the repo and push — never stored."}
              </p>
            </div>

            {isAmplify ? (
              <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <span className="text-sm font-semibold text-amber-300">Coming Soon</span>
                </div>
                <p className="text-xs text-amber-200">
                  AWS Amplify Gen 2 deploy requires a pre-connected Amplify Console app.
                  This template will be available once full automation is implemented.
                </p>
              </div>
            ) : selected.provider === "aws" ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    AWS Access Key ID
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                    value={awsAccessKey}
                    onChange={(e) => setAwsAccessKey(e.target.value)}
                    placeholder={envAwsAccessKeySet ? "Set via .env (optional here)" : "AKIA..."}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    AWS Secret Access Key
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                    value={awsSecretKey}
                    onChange={(e) => setAwsSecretKey(e.target.value)}
                    placeholder={envAwsSecretKeySet ? "Set via .env (optional here)" : "Your AWS secret key"}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Stored as GitHub repo secrets for the deploy workflow.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">AWS Region</label>
                  <input
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                    value={awsRegion}
                    onChange={(e) => setAwsRegion(e.target.value)}
                    placeholder="us-east-1"
                    autoComplete="off"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Leave blank to use the configured default region.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Cloudflare API token
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                    value={cloudflareToken}
                    onChange={(e) => setCloudflareToken(e.target.value)}
                    placeholder={envTokenSet ? "Set via .env (optional here)" : "Enter your Cloudflare API token"}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Stored as a GitHub repo secret for the deploy workflow.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Cloudflare account ID
                  </label>
                  <input
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    placeholder="Your 32-char Cloudflare account ID"
                    autoComplete="off"
                  />
                </div>
              </>
            )}

            {selected.provider === "cloudflare" && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Resources &amp; config</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">optional</span>
                </div>

                {selected.files.some((f) => f === "wrangler.toml" || f === "wrangler.jsonc" || f === "wrangler.json") && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-400">Bindings</span>
                      <button
                        type="button"
                        onClick={() =>
                          setLaunchBindings((prev) => [...prev, { type: "kv", name: "", resource: "" }])
                        }
                        className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white"
                      >
                        + Add binding
                      </button>
                    </div>
                    {launchBindings.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        Add KV, D1, R2, or AI Search bindings. The resource is created on the account
                        if it does not exist.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {launchBindings.map((b, i) => (
                          <div
                            key={i}
                            className="grid grid-cols-[92px_1fr_1fr_auto] items-center gap-2"
                          >
                            <select
                              value={b.type}
                              onChange={(e) =>
                                setLaunchBindings((prev) =>
                                  prev.map((row, j) =>
                                    j === i
                                      ? { ...row, type: e.target.value as LaunchBindingRow["type"] }
                                      : row
                                  )
                                )
                              }
                              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-slate-500"
                            >
                              {BINDING_TYPE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <input
                              value={b.name}
                              onChange={(e) =>
                                setLaunchBindings((prev) =>
                                  prev.map((row, j) =>
                                    j === i ? { ...row, name: e.target.value } : row
                                  )
                                )
                              }
                              placeholder="BINDING_NAME"
                              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                              autoCapitalize="none"
                              autoCorrect="off"
                            />
                            <input
                              value={b.resource}
                              onChange={(e) =>
                                setLaunchBindings((prev) =>
                                  prev.map((row, j) =>
                                    j === i ? { ...row, resource: e.target.value } : row
                                  )
                                )
                              }
                              placeholder="resource-name"
                              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                              autoCapitalize="none"
                              autoCorrect="off"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setLaunchBindings((prev) => prev.filter((_, j) => j !== i))
                              }
                              aria-label="Remove binding"
                              className="rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-400 hover:border-red-800 hover:text-red-300"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">
                      Environment variables
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setLaunchEnvVars((prev) => [...prev, { key: "", value: "", kind: "secret" }])
                      }
                      className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white"
                    >
                      + Add variable
                    </button>
                  </div>
                  {launchEnvVars.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      Values are stored encrypted and applied to the project once the first deploy
                      succeeds.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {launchEnvVars.map((v, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_86px_1fr_auto] items-center gap-2"
                        >
                          <input
                            value={v.key}
                            onChange={(e) =>
                              setLaunchEnvVars((prev) =>
                                prev.map((row, j) => (j === i ? { ...row, key: e.target.value } : row))
                              )
                            }
                            placeholder="KEY"
                            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                            autoCapitalize="none"
                            autoCorrect="off"
                          />
                          <select
                            value={v.kind}
                            onChange={(e) =>
                              setLaunchEnvVars((prev) =>
                                prev.map((row, j) =>
                                  j === i
                                    ? { ...row, kind: e.target.value as LaunchEnvVarRow["kind"] }
                                    : row
                                )
                              )
                            }
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-slate-500"
                          >
                            <option value="secret">Secret</option>
                            <option value="text">Text</option>
                          </select>
                          <input
                            type={v.kind === "secret" ? "password" : "text"}
                            value={v.value}
                            onChange={(e) =>
                              setLaunchEnvVars((prev) =>
                                prev.map((row, j) =>
                                  j === i ? { ...row, value: e.target.value } : row
                                )
                              )
                            }
                            placeholder="value"
                            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setLaunchEnvVars((prev) => prev.filter((_, j) => j !== i))
                            }
                            aria-label="Remove variable"
                            className="rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-400 hover:border-red-800 hover:text-red-300"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selected.type === "worker" && (
                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={previewEnabled}
                        onChange={(e) => setPreviewEnabled(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-600"
                      />
                      Per-branch preview deployments
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={provisionEnabled}
                        onChange={(e) => setProvisionEnabled(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-600"
                      />
                      Provisioning from pushed code
                    </label>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleLaunch}
              disabled={submitting || isAmplify}
              className={isAmplify
                ? "w-full rounded-md px-4 py-2.5 text-sm font-semibold transition-colors bg-slate-700 text-slate-400 cursor-not-allowed"
                : "w-full rounded-md px-4 py-2.5 text-sm font-semibold transition-colors bg-[#f6821f] text-slate-950 hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
              }
            >
              {submitting
                ? selected.source === "c3"
                  ? "Scaffolding with create-cloudflare, creating repo, pushing..."
                  : "Scaffolding, creating repo, pushing..."
                : isAmplify
                  ? "Coming Soon"
                  : "Launch app"}              </button>
          </div>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-400">
              Selection
            </h2>
            <dl className="space-y-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Language</dt>
                <dd className="text-slate-200">
                  {CATEGORIES.find((c) => c.id === selected.category)?.label}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Template</dt>
                <dd className="text-right text-slate-200">{selected.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Platform</dt>
                <dd className="text-slate-200">{platformLabel(selected)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Stack</dt>
                <dd className="text-slate-200">{templateStack(selected)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">URL</dt>
                <dd className="truncate font-mono text-slate-300" title="Assigned after deploy">
                  {selected.provider === "aws"
                    ? selected.type === "amplify"
                      ? "Amplify app URL"
                      : "API Gateway URL"
                    : selected.type === "pages"
                      ? "<name>.pages.dev"
                      : "<name>.<subdomain>.workers.dev"}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
              >
                Change language
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
              >
                Change template
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}