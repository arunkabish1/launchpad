"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TemplateInfo } from "@/lib/types";
import { CATEGORIES, templateStack } from "@/lib/template-meta";

interface TemplatesBrowserProps {
  templates: TemplateInfo[];
}

const platformLabel = (t: TemplateInfo) => {
  if (t.provider === "aws" && t.type === "amplify") return "AWS Amplify (Coming Soon)";
  if (t.provider === "aws") return "AWS Lambda";
  return t.type === "pages" ? "Cloudflare Pages" : "Cloudflare Workers";
};

const isAmplify = (t: TemplateInfo) => t.provider === "aws" && t.type === "amplify";

export default function TemplatesBrowser({ templates }: TemplatesBrowserProps) {
  const [selected, setSelected] = useState<TemplateInfo | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700"
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
                {isAmplify(t) && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                    coming soon
                  </span>
                )}
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                {CATEGORIES.find((c) => c.id === t.category)?.label ?? t.category}
              </span>
              <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {templateStack(t)}
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
              disabled={isAmplify(t)}
              className={isAmplify(t)
                ? "mt-4 w-full rounded-md border px-3 py-2 text-xs font-semibold transition-colors border-slate-700 text-slate-500 cursor-not-allowed"
                : "mt-4 w-full rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold transition-colors hover:border-[#f6821f] hover:text-[#f6821f]"}
            >
              {isAmplify(t) ? "Coming Soon" : "View details"}
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`${selected.name} details`}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-white">{selected.name}</h2>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {platformLabel(selected)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{selected.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                  {CATEGORIES.find((c) => c.id === selected.category)?.label ?? selected.category}
                </span>
                <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Stack: {templateStack(selected)}
                </span>
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
                  {selected.source === "c3" ? "create-cloudflare (live)" : "Built-in"}
                </span>
                {selected.requiresRoute && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                    Requires custom route
                  </span>
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
                <span className="mb-2 block text-xs font-medium text-slate-300">Deployment</span>
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
                  {selected.deploy?.setup && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Setup</dt>
                      <dd className="truncate font-mono text-slate-200" title={selected.deploy.setup}>
                        {selected.deploy.setup}
                      </dd>
                    </div>
                  )}
                  {selected.buildCommand && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Build</dt>
                      <dd className="truncate font-mono text-slate-200" title={selected.buildCommand}>
                        {selected.buildCommand}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Deploy</dt>
                    <dd
                      className="truncate font-mono text-slate-200"
                      title={selected.deploy?.command ?? selected.deployCommand}
                    >
                      {selected.deploy?.command ?? selected.deployCommand}
                    </dd>
                  </div>
                </dl>
              </div>

              {selected.c3 && (
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-slate-300">
                    create-cloudflare command
                  </span>
                  <code className="block rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
                    npm create cloudflare@latest -- {selected.c3.args.join(" ")}
                  </code>
                </div>
              )}

              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">
                  Files in template ({selected.files.length})
                </span>
                <ul className="grid gap-x-6 gap-y-1 font-mono text-[11px] text-slate-400 sm:grid-cols-2">
                  {selected.files.map((f) => (
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
                onClick={() => setSelected(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
              >
                Close
              </button>
              <Link
                href={`/?template=${selected.id}`}
                onClick={() => setSelected(null)}
                className="flex-1 rounded-md bg-[#f6821f] px-4 py-2 text-center text-xs font-semibold text-slate-950 transition-colors hover:bg-[#ff9436]"
              >
                Use this template →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
