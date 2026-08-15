"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/format";
import { Card, CardHeader, IconTerminal } from "./ui";

interface LiveLogsPanelProps {
  projectId: string;
  projectType: "worker" | "pages";
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

const MAX_ENTRIES = 200;

const OUTCOME_BADGE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-300",
  error: "bg-red-500/15 text-red-300",
  canceled: "bg-slate-500/15 text-slate-300",
  exceededCpu: "bg-red-500/15 text-red-300",
  unknown: "bg-amber-500/15 text-amber-300",
};

const LEVEL_BADGE: Record<string, string> = {
  log: "text-slate-300",
  info: "text-sky-300",
  debug: "text-slate-500",
  warn: "text-amber-300",
  error: "text-red-300",
};

const METHOD_BADGE: Record<string, string> = {
  GET: "text-emerald-300",
  HEAD: "text-slate-400",
  POST: "text-amber-300",
  PUT: "text-sky-300",
  PATCH: "text-sky-300",
  DELETE: "text-red-300",
  OPTIONS: "text-slate-400",
};

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
    const path = u.pathname === "/" ? "/" : u.pathname;
    return `${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

let entrySeq = 0;

export default function LiveLogsPanel({ projectId, projectType }: LiveLogsPanelProps) {
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [entries, setEntries] = useState<RenderedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
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

    setStreaming(true);

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
      if (block.startsWith("event: connected")) {
        setConnected(true);
      }
      if (block.startsWith("event: end")) {
        stop();
        return;
      }
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
      // aborted or stream error
    } finally {
      if (controllerRef.current === controller) {
        setStreaming(false);
        setConnected(false);
      }
    }
  }, [projectId, stop]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
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

  if (projectType !== "worker") {
    return (
      <Card>
        <CardHeader icon={<IconTerminal className="h-4 w-4 text-slate-400" />} title="Live logs" />
        <p className="px-5 pb-5 text-sm text-slate-500">
          Live logs are not yet supported for Pages projects.
        </p>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <h2 className="font-mono text-xs font-medium uppercase tracking-wide text-slate-400">
            live tail
          </h2>
          {streaming && (
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${
                connected ? "text-emerald-300" : "text-slate-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? "animate-pulse bg-emerald-400" : "bg-slate-600"
                }`}
              />
              {connected ? "LISTENING" : "CONNECTING"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">
              {entries.length} {entries.length === 1 ? "event" : "events"}
            </span>
          )}
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-red-800 px-2.5 py-1 text-xs text-red-300 hover:border-red-600 hover:text-red-200"
            >
              Stop tail
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-md bg-[#f6821f] px-2.5 py-1 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#ff9436]"
            >
              Tail live logs
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 font-mono text-xs text-amber-300">
          {error}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {entries.length === 0 ? (
          <p className="py-4 text-slate-600">
            {streaming
              ? "Waiting for requests… send a request to your worker and it will appear here."
              : "Start a live tail to see requests hitting this worker in near real-time."}
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="group mb-3 border-b border-slate-800/60 pb-2 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-600">{e.at}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    OUTCOME_BADGE[e.outcome] ?? OUTCOME_BADGE.unknown
                  }`}
                >
                  {e.outcome}
                </span>
                {e.method && (
                  <span className={`font-semibold ${METHOD_BADGE[e.method] ?? "text-slate-300"}`}>
                    {e.method}
                  </span>
                )}
                {e.url && <span className="text-slate-300">{e.url}</span>}
                <button
                  type="button"
                  onClick={() => void handleCopyEntry(e)}
                  className="ml-auto hidden rounded border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300 group-hover:inline-flex"
                >
                  Copy
                </button>
              </div>
              {e.logs.length > 0 &&
                e.logs.map((l, i) => (
                  <div key={i} className="mt-1 pl-1">
                    <span className={`font-semibold ${LEVEL_BADGE[l.level] ?? "text-slate-300"}`}>
                      [{l.level}]
                    </span>{" "}
                    <span className="text-slate-200">{l.text}</span>
                  </div>
                ))}
              {e.errors.map((err, i) => (
                <div key={i} className="mt-1 whitespace-pre-wrap text-red-300">
                  {err.name}: {err.message}
                  {err.stack && <span className="block text-red-400/70">{err.stack}</span>}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 bg-slate-900/40 px-4 py-2">
        <div className="flex items-center gap-3">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => setEntries([])}
              className="rounded border border-slate-800 px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
            >
              Clear
            </button>
          )}
          {!autoScroll && entries.length > 0 && (
            <button
              type="button"
              onClick={() => setAutoScroll(true)}
              className="rounded border border-sky-800 px-2 py-0.5 text-[11px] text-sky-300 transition-colors hover:border-sky-600"
            >
              Resume autoscroll ↓
            </button>
          )}
          <span className="text-[11px] text-slate-600">
            Ephemeral · may be sampled under high traffic
          </span>
        </div>
      </div>
    </div>
  );
}
