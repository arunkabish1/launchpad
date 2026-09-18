"use client";

import { useCallback, useEffect, useState } from "react";
import type { GithubInviteState, Membership, ProjectRole } from "@/lib/types";
import { Badge, Card, CardHeader, CopyButton, EmptyState, IconBox } from "./ui";

interface InviteRow {
  tokenHash: string;
  role: ProjectRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "accepted" | "expired";
}

interface MembersPanelProps {
  projectId: string;
  projectName: string;
  role: ProjectRole;
  canManage: boolean;
}

function roleBadge(role: ProjectRole) {
  return role === "owner"
    ? "bg-[#f6821f]/15 text-[#f6821f] border-[#f6821f]/30"
    : "bg-sky-500/15 text-sky-300 border-sky-500/30";
}

function githubStateMeta(state: GithubInviteState): { label: string; className: string } {
  switch (state) {
    case "active":
      return { label: "GitHub: collaborator", className: "bg-emerald-500/15 text-emerald-300" };
    case "pending":
      return { label: "GitHub: invite sent", className: "bg-amber-500/15 text-amber-300" };
    case "failed":
      return { label: "GitHub: failed", className: "bg-red-500/15 text-red-300" };
    default:
      return { label: "No GitHub link", className: "bg-slate-800/70 text-slate-500" };
  }
}

export default function MembersPanel({
  projectId,
  projectName,
  role,
  canManage,
}: MembersPanelProps) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<ProjectRole>("member");
  const [creating, setCreating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/members`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load members.");
        return;
      }
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
      setError(null);
    } catch {
      setError("Failed to reach the Launchpad server.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const tick = async () => {
      await load();
    };
    void tick();
  }, [load]);

  async function handleCreateInvite() {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create the invite.");
        return;
      }
      setInviteUrl(data.url);
      setNotice(`Invite link created (${inviteRole}). It expires in 7 days.`);
      await load();
    } catch {
      setError("Network error while creating the invite.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(userId: string, nextRole: ProjectRole) {
    setBusyUser(userId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to change the role.");
        return;
      }
      await load();
    } catch {
      setError("Network error while changing the role.");
    } finally {
      setBusyUser(null);
    }
  }

  async function handleRemove(userId: string, username: string) {
    if (!confirm(`Remove ${username} from "${projectName}"?`)) return;
    setBusyUser(userId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to remove the member.");
        return;
      }
      await load();
    } catch {
      setError("Network error while removing the member.");
    } finally {
      setBusyUser(null);
    }
  }

  async function handleRevoke(tokenHash: string) {
    setBusyUser(tokenHash);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/invites/${tokenHash}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to revoke the invite.");
        return;
      }
      await load();
    } catch {
      setError("Network error while revoking the invite.");
    } finally {
      setBusyUser(null);
    }
  }

  return (
    <div className="space-y-6">
      {(error || notice) && (
        <div className="space-y-2">
          {error && (
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/25 px-4 py-3 text-sm text-amber-300">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-sky-800/40 bg-sky-950/25 px-4 py-3 text-sm text-sky-300">
              {notice}
            </div>
          )}
        </div>
      )}

      {canManage && (
        <Card>
          <CardHeader icon={<IconBox className="h-4 w-4 text-slate-400" />} title="Invite a member" />
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-slate-400">
              Invite links are single-use and expire after 7 days. The person you invite chooses
              their username and GitHub handle when they accept.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-slate-500"
              >
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
              <button
                type="button"
                onClick={handleCreateInvite}
                disabled={creating}
                className="rounded-lg bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Creating…" : "Generate invite link"}
              </button>
            </div>
            {inviteUrl && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-[#f6821f]">
                  {inviteUrl}
                </code>
                <CopyButton text={inviteUrl} iconOnly />
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<IconBox className="h-4 w-4 text-slate-400" />}
          title="Members"
          count={members.length}
        />
        {loading ? (
          <div className="px-5 py-6 text-sm text-slate-500">Loading…</div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={<IconBox className="h-6 w-6" />}
            title="No members yet"
            hint="Generate an invite link to add the first member."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800/80 bg-slate-950/40 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-5 py-3">Username</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">GitHub</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {members.map((m) => {
                  const gh = githubStateMeta(m.githubInviteState);
                  return (
                    <tr key={m.userId} className="transition-colors hover:bg-slate-950/50">
                      <td className="px-5 py-3 font-mono text-slate-200">{m.username}</td>
                      <td className="px-5 py-3">
                        {canManage ? (
                          <select
                            value={m.role}
                            disabled={busyUser === m.userId}
                            onChange={(e) =>
                              handleRoleChange(m.userId, e.target.value as ProjectRole)
                            }
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-slate-500"
                          >
                            <option value="member">Member</option>
                            <option value="owner">Owner</option>
                          </select>
                        ) : (
                          <Badge className={roleBadge(m.role)}>{m.role}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-xs text-slate-400">
                            {m.githubUsername ?? "—"}
                          </span>
                          <span
                            className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${gh.className}`}
                            title={m.githubInviteError}
                          >
                            {gh.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canManage && (
                          <button
                            type="button"
                            disabled={busyUser === m.userId}
                            onClick={() => handleRemove(m.userId, m.username)}
                            className="rounded-lg border border-slate-700/80 bg-slate-800/40 px-3 py-1 text-xs text-red-300 transition-all hover:border-red-700 hover:bg-red-950/40 disabled:opacity-60"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && invites.length > 0 && (
        <Card>
          <CardHeader
            icon={<IconBox className="h-4 w-4 text-slate-400" />}
            title="Invites"
            count={invites.length}
          />
          <div className="divide-y divide-slate-800/60">
            {invites.map((inv) => (
              <div key={inv.tokenHash} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">
                    <Badge className={roleBadge(inv.role)}>{inv.role}</Badge>
                    <span
                      className={`ml-2 text-xs ${
                        inv.state === "pending" ? "text-amber-300" : "text-slate-500"
                      }`}
                    >
                      {inv.state}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    by {inv.createdBy} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                {inv.state === "pending" && (
                  <button
                    type="button"
                    disabled={busyUser === inv.tokenHash}
                    onClick={() => handleRevoke(inv.tokenHash)}
                    className="shrink-0 rounded-lg border border-slate-700/80 bg-slate-800/40 px-3 py-1 text-xs text-slate-300 transition-all hover:border-slate-600 hover:bg-slate-700/60 disabled:opacity-60"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-slate-500">
        Signed in as a project <span className="text-slate-400">{role}</span>. Access is scoped to
        this project; global admins see everything.
      </p>
    </div>
  );
}
