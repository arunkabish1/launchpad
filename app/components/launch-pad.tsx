"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TemplateCategory, TemplateInfo } from "@/lib/types";
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

  const [projectName, setProjectName] = useState("");
  const [route, setRoute] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [githubPat, setGithubPat] = useState("");
  const [cloudflareToken, setCloudflareToken] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [awsAccessKey, setAwsAccessKey] = useState("");
  const [awsSecretKey, setAwsSecretKey] = useState("");
  const [awsRegion, setAwsRegion] = useState("");

  const isAmplify = selected?.provider === "aws" && selected?.type === "amplify";

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
              onClick={() => setSelected(t)}
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
                onClick={() => setSelected(t)}
                className="mt-4 w-full rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-[#f6821f] hover:text-[#f6821f]"
              >
                View details
              </button>
            </div>
          ))}
        </div>
      </div>
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