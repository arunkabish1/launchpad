import crypto from "node:crypto";
import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2.js";

function deriveKey(secret: string, keyLength: number): Uint8Array {
  const hash = crypto.createHash("sha256").update(secret).digest();
  if (hash.length !== keyLength) throw new Error("Derived key has an unexpected length.");
  return Uint8Array.from(hash);
}

function getSecret(): string | null {
  return process.env.LAUNCHPAD_SECRET?.trim() || null;
}

export function hasSecretKey(): boolean {
  return Boolean(getSecret());
}

export async function encrypt(plain: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("LAUNCHPAD_SECRET is not set; cannot persist secrets.");
  const key = deriveKey(secret, nacl.secretbox.keyLength);
  const nonce = crypto.randomBytes(nacl.secretbox.nonceLength);
  const cipher = nacl.secretbox(new TextEncoder().encode(plain), nonce, key);
  return `${Buffer.from(nonce).toString("base64")}.${Buffer.from(cipher).toString("base64")}`;
}

export async function decrypt(payload: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("LAUNCHPAD_SECRET is not set; cannot decrypt persisted secrets.");
  const [nonceB64, cipherB64] = payload.split(".");
  if (!nonceB64 || !cipherB64) throw new Error("Malformed encrypted payload.");
  const key = deriveKey(secret, nacl.secretbox.keyLength);
  const nonce = Uint8Array.from(Buffer.from(nonceB64, "base64"));
  const cipher = Uint8Array.from(Buffer.from(cipherB64, "base64"));
  const plain = nacl.secretbox.open(cipher, nonce, key);
  if (plain === null) throw new Error("Failed to decrypt payload (wrong key?).");
  return new TextDecoder().decode(plain);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function sealBox(plain: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(concatBytes(ephemeral.publicKey, recipientPublicKey), {
    dkLen: nacl.box.nonceLength,
  });
  const body = nacl.box(plain, nonce, recipientPublicKey, ephemeral.secretKey);
  const sealed = new Uint8Array(ephemeral.publicKey.length + body.length);
  sealed.set(ephemeral.publicKey, 0);
  sealed.set(body, ephemeral.publicKey.length);
  return sealed;
}
