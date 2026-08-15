import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_NAME,
  createSessionToken,
  actorName,
  getAdminPassword,
  isAdminPasswordSet,
  verifyPassword,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

const attempts = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_ATTEMPTS) {
    attempts.set(ip, list);
    return true;
  }
  list.push(now);
  attempts.set(ip, list);
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAdminPasswordSet()) {
    return NextResponse.json(
      { error: "No admin password is configured (set LAUNCHPAD_ADMIN_PASSWORD)." },
      { status: 503 }
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: { password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!verifyPassword(body.password ?? "", getAdminPassword())) {
    recordAudit({ actor: "unknown", action: "login", project: "-", detail: "failed login", outcome: "error" });
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const name = actorName(body.name);
  const token = createSessionToken(name);

  const res = NextResponse.json({ ok: true, name });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  recordAudit({ actor: name, action: "login", project: "-", detail: "login", outcome: "ok" });
  return res;
}
