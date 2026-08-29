import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { getCloudflareToken } from "@/lib/cf";
import { getDefaultAccountId } from "@/lib/config";
import { requireAuth, authRequiredResponse } from "@/lib/auth";

export const runtime = "nodejs";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const TRACE_PROTOCOL = "trace-v1";
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000];
const KEEPALIVE_MS = 15_000;

interface TailCreateResult {
  id: string;
  url: string;
  expires_at: string;
}

interface CfResponse {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: TailCreateResult;
}

interface ActiveTail {
  stop: () => void;
}

const activeTails = new Map<string, ActiveTail>();

function cfHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/logs/live">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (project.provider !== "cloudflare" || project.type !== "worker") {
    return NextResponse.json(
      { error: "Live logs are only available for Cloudflare Workers projects right now." },
      { status: 400 }
    );
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  if (!token || !accountId) {
    return NextResponse.json(
      { error: "Cloudflare credentials are not configured on the server." },
      { status: 400 }
    );
  }

  if (activeTails.has(project.id)) {
    return NextResponse.json(
      { error: "A live log tail is already connected for this project." },
      { status: 409 }
    );
  }

  const script = encodeURIComponent(project.name);
  const createRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${script}/tails`,
    {
      method: "POST",
      headers: { ...cfHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ filters: [] }),
    }
  );
  const createBody = (await createRes.json().catch(() => null)) as CfResponse | null;
  if (!createRes.ok || !createBody?.success || !createBody.result) {
    const detail =
      createBody?.errors?.map((e) => e.message).join(", ") || `HTTP ${createRes.status}`;
    return NextResponse.json(
      { error: `Failed to start the live log tail: ${detail}` },
      { status: 502 }
    );
  }
  const { id: tailId, url } = createBody.result;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let ws: WebSocket | null = null;
      let stopped = false;
      let attempts = 0;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;

      const teardown = async (sendEnd: boolean) => {
        if (stopped) return;
        stopped = true;
        if (keepAlive) clearInterval(keepAlive);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        try {
          ws?.close();
        } catch {
          // ignore
        }
        try {
          await fetch(
            `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${script}/tails/${tailId}`,
            { method: "DELETE", headers: cfHeaders(token) }
          );
        } catch {
          // best-effort cleanup
        }
        activeTails.delete(project.id);
        try {
          if (sendEnd) controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          controller.close();
        } catch {
          // stream already closed
        }
      };

      activeTails.set(project.id, {
        stop: () => {
          void teardown(false);
        },
      });

      const connect = () => {
        if (stopped) return;
        let socket: WebSocket;
        try {
          socket = new WebSocket(url, [TRACE_PROTOCOL]);
        } catch {
          void teardown(true);
          return;
        }
        ws = socket;

        socket.addEventListener("open", () => {
          if (stopped) {
            try {
              socket.close();
            } catch {
              // ignore
            }
            return;
          }
          attempts = 0;
          try {
            socket.send(JSON.stringify({ debug: false }));
            controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
          } catch {
            // ignore
          }
        });

        socket.addEventListener("message", (ev) => {
          if (stopped) return;
          const raw = ev.data as unknown;
          const enqueue = (data: string) => {
            if (!data) return;
            try {
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            } catch {
              // stream closed
            }
          };
          if (typeof raw === "string") {
            enqueue(raw);
          } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
            void raw
              .text()
              .then((text) => {
                if (!stopped) enqueue(text);
              })
              .catch(() => {
                // ignore unreadable frames
              });
          } else if (ArrayBuffer.isView(raw)) {
            enqueue(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8"));
          } else if (raw instanceof ArrayBuffer) {
            enqueue(Buffer.from(raw).toString("utf8"));
          }
        });

        socket.addEventListener("close", () => {
          if (stopped) return;
          if (attempts < RECONNECT_BACKOFF_MS.length) {
            const delay = RECONNECT_BACKOFF_MS[attempts];
            attempts += 1;
            reconnectTimer = setTimeout(connect, delay);
          } else {
            void teardown(true);
          }
        });

        socket.addEventListener("error", () => {
          try {
            socket.close();
          } catch {
            // ignore
          }
        });
      };

      connect();

      keepAlive = setInterval(() => {
        if (!stopped) {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // stream closed
          }
        }
      }, KEEPALIVE_MS);

      req.signal.addEventListener("abort", () => {
        void teardown(false);
      });
    },
    cancel() {
      const entry = activeTails.get(project.id);
      if (entry) entry.stop();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
