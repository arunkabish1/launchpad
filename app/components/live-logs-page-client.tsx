"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/format";

interface LiveLogsPageClientProps {
  projectId: string;
  projectName: string;
}

interface TailLogEntry {
  level?: string;
  message: unknown[];
  timestamp?: number;
}

interface TailException {
  name: string;
  message: unknown;
  timestamp?: number;
  stack?: string;
}

interface TailEvent {
  request?: { method?: string; url?: string };
  cron?: string;
}

interface TailEventMessage {
  outcome: string;
  eventTimestamp?: number;
  logs?: TailLogEntry[];
  exceptions?: TailException[];
  event?: TailEvent | null;
}

interface RenderedEntry {
  id: number;
  at: string;
  outcome: string;
  method?: string;
  url?: string;
  logs: Array<{ level: string; text: string }>;
  errors: Array<{ name: string; message: string; stack?: string }>;
}

const MAX_ENTRIES = 500;
let entrySeq = 0;

function stringifyMessage(msg: unknown): string {
  if (typeof msg === "string") return msg;
  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg);
  }
}

function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

const OUTCOME_COLOR: Record<string, string> = {
  ok: "bg-emerald-500/20 text-emerald-300",
  error: "bg-red-500/20 text-red-300",
  canceled: "bg-slate-500/20 text-slate-400",
  exceededCpu: "bg-red-500/20 text-red-300",
  unknown: "bg-amber-500/20 text-amber-300",
};

const LEVEL_COLOR: Record<string, string> = {
  log: "text-slate-300",
  info: "text-sky-300",
  debug: "text-slate-500",
  warn: "text-amber-300",
  error: "text-red-300",
};

const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  HEAD: "text-slate-400",
  POST: "text-amber-400",
  PUT: "text-sky-400",
  PATCH: "text-sky-400",
  DELETE: "text-red-400",
  OPTIONS: "text-slate-400",
};

// Static branch list – in a real scenario you could fetch from GitHub API
const BRANCHES = ["main", "dev", "staging", "feature/preview", "fix/hotfix"];

export default function LiveLogsPageClient({ projectId, projectName }: LiveLogsPageClientProps) {
  const [selectedBranch, setSelectedBranch] = useState("main");
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [entries, setEntries] = useState<RenderedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [entries, connected, autoScroll]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreaming(false);
    setConnected(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setEntries([]);
    setAutoScroll(true);

    const controller = new AbortController();
    controllerRef.current = controller;
    setStreaming(true);

    let res: Response;
    try {
      res = await fetch(`/api/projects/${projectId}/logs/live`, { signal: controller.signal });
    } catch {
      setStreaming(false);
      setConnected(false);
      setError("Failed to start the live log stream.");
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setStreaming(false);
      setConnected(false);
      setError(data?.error ?? `Live logs returned HTTP ${res.status}.`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setStreaming(false);
      setError("Live logs are not supported by this browser.");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    const handleBlock = (block: string) => {
      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (block.startsWith("event: connected")) setConnected(true);
      if (block.startsWith("event: end")) { stop(); return; }
      for (const raw of dataLines) {
        if (!raw) continue;
        let msg: TailEventMessage;
        try {
          msg = JSON.parse(raw) as TailEventMessage;
        } catch {
          continue;
        }
        const at = msg.eventTimestamp ? new Date(msg.eventTimestamp).toLocaleTimeString() : "";
        const request = msg.event?.request;
        const logs = (msg.logs ?? []).map((l) => ({
          level: l.level ?? "log",
          text: (l.message ?? []).map(stringifyMessage).join(" "),
        }));
        const errors = (msg.exceptions ?? []).map((e) => ({
          name: e.name,
          message: stringifyMessage(e.message),
          stack: e.stack,
        }));
        const entry: RenderedEntry = {
          id: entrySeq++,
          at,
          outcome: msg.outcome,
          method: request?.method,
          url: request?.url ? describeUrl(request.url) : undefined,
          logs,
          errors,
        };
        setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry]);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleBlock(block);
        }
      }
    } catch {
      // Aborted or stream error
    } finally {
      if (controllerRef.current === controller) {
        setStreaming(false);
        setConnected(false);
      }
    }
  }, [projectId, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { controllerRef.current?.abort(); };
  }, []);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  }

  async function handleCopyEntry(entry: RenderedEntry) {
    const lines = [
      `${entry.at} ${entry.method ?? ""} ${entry.url ?? ""} [${entry.outcome}]`,
      ...entry.logs.map((l) => `[${l.level}] ${l.text}`),
      ...entry.errors.map((e) => `${e.name}: ${e.message}`),
    ];
    await copyToClipboard(lines.join("\n"));
  }

  return (
    <div className="fixed inset-y-0 right-0 left-0 top-16 lg:top-0 lg:left-[var(--sidebar-w,16rem)] z-20 flex flex-col bg-[#040a14]">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between border-b border-slate-800/70 bg-[#080f1e] px-6 py-3.5">
        <div className="flex items-center gap-4">
          <Link
            href={`/projects/${projectId}`}
            className="flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to project
          </Link>
          <span className="h-5 w-px bg-slate-800" />
          <div className="flex items-center gap-2.5">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17l6-5-6-5" /><path d="M12 19h8" />
            </svg>
            <span className="text-sm font-semibold text-slate-200">Live Logs</span>
            <span className="rounded-md border border-[#f6821f]/25 bg-[#f6821f]/10 px-2 py-0.5 font-mono text-[11px] text-[#f6821f]">
              {projectName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection indicator */}
          {streaming && (
            <div className="flex items-center gap-2 font-mono text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                }`}
              />
              <span className={connected ? "text-emerald-300" : "text-slate-500"}>
                {connected ? "LISTENING" : "CONNECTING…"}
              </span>
            </div>
          )}

          {/* Branch selector */}
          <div className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
            <select
              id="live-logs-branch-select"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              disabled={streaming}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 font-mono text-xs text-slate-200 outline-none transition-colors hover:border-slate-600 focus:border-[#f6821f]/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {BRANCHES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Connect / Stop */}
          {streaming ? (
            <button
              type="button"
              id="live-logs-stop-btn"
              onClick={stop}
              className="inline-flex items-center gap-2 rounded-lg border border-red-700/50 bg-red-500/10 px-4 py-1.5 text-sm font-semibold text-red-300 transition-all hover:border-red-600 hover:bg-red-500/15"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="button"
              id="live-logs-connect-btn"
              onClick={() => void start()}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#f6821f] to-[#c06010] px-4 py-1.5 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(246,130,31,0.3)] transition-all hover:from-[#ff9436] hover:to-[#d07020] hover:shadow-[0_4px_20px_rgba(246,130,31,0.45)]"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              Connect
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 font-mono text-xs text-amber-300">
          {error}
        </div>
      )}

      {/* ── Terminal body ── */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#060d1a] px-6 py-5 font-mono text-xs leading-relaxed"
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <svg className="h-8 w-8 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17l6-5-6-5" /><path d="M12 19h8" />
            </svg>
            <p className="text-slate-600">
              {streaming
                ? "Waiting for requests… send a request to your worker and it will appear here."
                : `Select a branch and click Connect to start streaming live logs from ${projectName}.`}
            </p>
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className="group mb-4 border-b border-slate-800/40 pb-3 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-slate-700">{e.at}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    OUTCOME_COLOR[e.outcome] ?? OUTCOME_COLOR.unknown
                  }`}
                >
                  {e.outcome}
                </span>
                {e.method && (
                  <span className={`font-bold ${METHOD_COLOR[e.method] ?? "text-slate-300"}`}>
                    {e.method}
                  </span>
                )}
                {e.url && <span className="text-slate-400">{e.url}</span>}
                <button
                  type="button"
                  onClick={() => void handleCopyEntry(e)}
                  className="ml-auto hidden rounded border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-600 transition-colors hover:border-slate-600 hover:text-slate-300 group-hover:inline-flex"
                >
                  Copy
                </button>
              </div>
              {e.logs.length > 0 &&
                e.logs.map((l, i) => (
                  <div key={i} className="mt-1 pl-2">
                    <span className={`font-semibold ${LEVEL_COLOR[l.level] ?? "text-slate-300"}`}>
                      [{l.level}]
                    </span>{" "}
                    <span className="text-slate-200">{l.text}</span>
                  </div>
                ))}
              {e.errors.map((err, i) => (
                <div key={i} className="mt-1 whitespace-pre-wrap pl-2 text-red-300">
                  {err.name}: {err.message}
                  {err.stack && <span className="block text-red-400/60">{err.stack}</span>}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between border-t border-slate-800/60 bg-[#080f1e] px-6 py-2.5">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>Events</span>
            <span className="rounded border border-slate-800 bg-slate-900/60 px-2 py-0.5 font-mono text-slate-400">
              {entries.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Branch</span>
            <span className="rounded border border-slate-800 bg-slate-900/60 px-2 py-0.5 font-mono text-slate-400">
              {streaming ? selectedBranch : "—"}
            </span>
          </div>
          <span className="text-slate-700">Ephemeral · may be sampled under high traffic</span>
        </div>

        <div className="flex items-center gap-3">
          {!autoScroll && entries.length > 0 && (
            <button
              type="button"
              onClick={() => setAutoScroll(true)}
              className="rounded border border-sky-800 px-2.5 py-1 text-[11px] text-sky-400 transition-colors hover:border-sky-600"
            >
              Resume scroll ↓
            </button>
          )}
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => setEntries([])}
              className="rounded border border-slate-800 px-2.5 py-1 text-[11px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
