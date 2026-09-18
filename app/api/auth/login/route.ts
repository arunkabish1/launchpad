import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_NAME,
  createSessionToken,
  getAdminPassword,
  isAdminPasswordSet,
  verifyPassword,
} from "@/lib/auth";
import {
  bootstrapAdminUsername,
  countUsers,
  createUser,
  getUserByUsername,
  normalizeUsername,
} from "@/lib/users";
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

  let body: { password?: string; username?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!verifyPassword(body.password ?? "", getAdminPassword())) {
    recordAudit({ actor: "unknown", action: "login", project: "-", detail: "failed login", outcome: "error" });
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const username = normalizeUsername(body.username ?? body.name ?? "");
  if (!username) {
    return NextResponse.json({ error: "A username is required." }, { status: 400 });
  }

  try {
    let user = await getUserByUsername(username);
    if (!user) {
      const isFirst = (await countUsers()) === 0;
      const isBootstrap = username === bootstrapAdminUsername();
      if (isFirst || isBootstrap) {
        user = await createUser({ username, globalRole: "admin" });
      } else {
        return NextResponse.json(
          { error: "Unknown username. Ask a project owner to send you an invite." },
          { status: 401 }
        );
      }
    }

    const token = createSessionToken({
      id: user.id,
      username: user.username,
      globalRole: user.globalRole,
    });

    const res = NextResponse.json({
      ok: true,
      user: { username: user.username, globalRole: user.globalRole },
    });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    recordAudit({ actor: user.username, action: "login", project: "-", detail: "login", outcome: "ok" });
    return res;
  } catch (err) {
    console.error("Login failed:", err);
    return NextResponse.json({ error: "Login failed: " + (err as Error).message }, { status: 500 });
  }
}
