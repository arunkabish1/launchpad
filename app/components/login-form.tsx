"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("Network error. Is the Launchpad server running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300">Name (optional)</label>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (shown in the audit log)"
          autoComplete="name"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300">Password</label>
        <input
          type="password"
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Launchpad password"
          autoComplete="current-password"
          autoFocus
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-[#f6821f] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
