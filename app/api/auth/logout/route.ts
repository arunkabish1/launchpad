import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  let actor = "admin";
  if (token) {
    const session = parseSessionToken(token);
    if (session) actor = session.name;
  }
  recordAudit({ actor, action: "logout", project: "-", detail: "logout", outcome: "ok" });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
