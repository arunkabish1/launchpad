"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface InviteAcceptFormProps {
  token: string;
}

type InviteState = "pending" | "accepted" | "expired";

export default function InviteAcceptForm({ token }: InviteAcceptFormProps) {
  const [projectName, setProjectName] = useState<string | null>(null);
  const [role, setRole] = useState<string>("member");
  const [state, setState] = useState<InviteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "This invite link is invalid.");
          return;
        }
        setProjectName(data.projectName);
        setRole(data.role);
        setState(data.state);
      })
      .catch(() => setError("Failed to load the invite."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, username, githubUsername }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to accept the invite.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Is the Launchpad server running?");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading invite…</p>;
  }

  if (error && !projectName) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
        <Link href="/login" className="text-sm text-[#f6821f] hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  if (state && state !== "pending" && !done) {
    return (
      <div className="rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
        This invite has already been {state === "accepted" ? "used" : "expired"}.
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
          You&apos;ve joined <span className="font-semibold">{projectName}</span> as a {role}.
        </div>
        <p className="text-sm text-slate-400">
          Sign in with the Launchpad password and the username you chose to access the project.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436]"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleAccept} className="space-y-4">
      <div className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
        You&apos;ve been invited to <span className="font-semibold">{projectName}</span> as a{" "}
        <span className="text-[#f6821f]">{role}</span>.
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300">
          Choose a username
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. jane-doe"
          autoComplete="username"
          autoFocus
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Lowercase letters, numbers, dots, dashes or underscores.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300">
          GitHub username (optional)
        </label>
        <input
          value={githubUsername}
          onChange={(e) => setGithubUsername(e.target.value)}
          placeholder="Your GitHub handle"
          autoComplete="off"
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Adding this invites you as a collaborator on the project&apos;s GitHub repo.
        </p>
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
        {submitting ? "Joining…" : "Accept invite"}
      </button>
    </form>
  );
}
