"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TemplateCategory, TemplateInfo } from "@/lib/types";
import { CATEGORIES, templateStack } from "@/lib/template-meta";

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
      if (!envTokenSet && !cloudflareToken.trim()) {
        setError("Enter a Cloudflare API token.");
        return;
      }
      if (!accountId.trim()) {
        setError("Enter your Cloudflare account ID.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: selected.id,
          projectName,
          route: route.trim() || undefined,
          private: isPrivate,
          githubPat: githubPat.trim() || undefined,
          ...(selected.provider === "aws"
            ? {
                awsAccessKey: awsAccessKey.trim() || undefined,
                awsSecretKey: awsSecretKey.trim() || undefined,
                awsRegion: awsRegion.trim() || undefined,
              }
            : {
                cloudflareToken: cloudflareToken.trim() || undefined,
                accountId: accountId.trim() || undefined,
              }),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Launch failed.");
        return;
      }
      router.push(`/projects/${data.project.id}`);
    } catch {
      setError("Network error. Is the Launchpad server running?");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500";

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: "Language" },
    { n: 2, label: "Template" },
    { n: 3, label: "Options" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-700">/</span>}
            <button
              type="button"
              disabled={s.n > step}
              onClick={() => (s.n === 2 ? setStep(2) : s.n === 3 && selected ? setStep(3) : setStep(1))}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                s.n === step
                  ? "bg-[#f6821f]/15 text-[#f6821f]"
                  : s.n < step
                    ? "text-slate-300 hover:text-white"
                    : "cursor-not-allowed text-slate-600"
              }`}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-800 text-[10px] text-slate-300">
                {s.n}
              </span>
              {s.label}
            </button>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-400">
            Choose a language
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Pick the language or app type you want to deploy.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const count = templates.filter((t) => t.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => resetToCategory(cat.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    category === cat.id
                      ? "border-[#f6821f] bg-slate-800/60 ring-1 ring-[#f6821f]"
                      : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{cat.label}</span>
                    <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {count} {count === 1 ? "template" : "templates"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{cat.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && category && (
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
                {CATEGORIES.find((c) => c.id === category)?.label} templates
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Pick the template to deploy, then configure its deployment options.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
            >
              ← Change language
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {categoryTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSelected(t);
                  setStep(3);
                }}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  selected?.id === t.id
                    ? "border-[#f6821f] bg-slate-800/60 ring-1 ring-[#f6821f]"
                    : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{t.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {platformLabel(t)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {t.source === "c3" && (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
                      create-cloudflare
                    </span>
                  )}
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                    {templateStack(t)}
                  </span>
                  {t.buildCommand && (
                    <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      build
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && selected && (
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
                  className={inputClass}
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
                    className={inputClass}
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
                  className={inputClass}
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

              {selected.provider === "aws" ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      AWS Access Key ID
                    </label>
                    <input
                      type="password"
                      className={inputClass}
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
                      className={inputClass}
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
                      className={inputClass}
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
                      className={inputClass}
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
                      className={inputClass}
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
                disabled={submitting}
                className="w-full rounded-md bg-[#f6821f] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? selected.source === "c3"
                    ? "Scaffolding with create-cloudflare, creating repo, pushing…"
                    : "Scaffolding, creating repo, pushing…"
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
      )}
    </div>
  );
}
