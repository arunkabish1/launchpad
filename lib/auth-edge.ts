export const EDGE_COOKIE_NAME = "launchpad_session";

function sessionSecret(): string | null {
  return (
    process.env.LAUNCHPAD_SESSION_SECRET?.trim() ||
    process.env.LAUNCHPAD_SECRET?.trim() ||
    null
  );
}

async function hmac(data: string): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hasValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await hmac(payload);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let equal = 0;
  for (let i = 0; i < a.length; i++) equal |= a[i] ^ b[i];
  if (equal !== 0) return false;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}
