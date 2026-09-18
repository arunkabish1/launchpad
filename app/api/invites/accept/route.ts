import { NextRequest, NextResponse } from "next/server";
import { acceptInvite, getInviteByToken, inviteState } from "@/lib/invites";
import { createUser, getUserByUsername, normalizeUsername, updateUserGithub } from "@/lib/users";
import { syncGithubCollaborator, upsertMembership } from "@/lib/membership";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{1,39}$/;

export async function POST(req: NextRequest) {
  let body: { token?: string; username?: string; githubUsername?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = (body.token ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "An invite token is required." }, { status: 400 });
  }

  const invite = await getInviteByToken(raw);
  if (!invite) {
    return NextResponse.json({ error: "This invite link is invalid." }, { status: 404 });
  }
  const state = inviteState(invite);
  if (state === "accepted") {
    return NextResponse.json({ error: "This invite has already been used." }, { status: 410 });
  }
  if (state === "expired") {
    return NextResponse.json({ error: "This invite has expired." }, { status: 410 });
  }

  const username = normalizeUsername(body.username ?? "");
  if (!USERNAME_REGEX.test(username)) {
    return NextResponse.json(
      {
        error:
          "Choose a username of 2–40 characters using lowercase letters, numbers, dots, dashes or underscores.",
      },
      { status: 400 }
    );
  }

  try {
    let user = await getUserByUsername(username);
    if (!user) {
      user = await createUser({ username, globalRole: "member" });
    }

    const githubUsername = (body.githubUsername ?? "").trim();
    if (githubUsername) {
      await updateUserGithub(user.id, githubUsername);
    }

    await upsertMembership({
      projectId: invite.projectId,
      userId: user.id,
      username: user.username,
      role: invite.role,
      githubUsername: githubUsername || null,
    });

    const accepted = await acceptInvite(raw, user.id);
    if (!accepted) {
      return NextResponse.json(
        { error: "This invite is no longer available." },
        { status: 410 }
      );
    }

    const collaborator = await syncGithubCollaborator(invite.projectId, user.id, "add").catch(
      (err) => ({ ok: false, state: "failed" as const, error: (err as Error).message })
    );

    recordAudit({
      actor: user.username,
      action: "invite_accept",
      project: invite.projectName,
      detail: `Joined as ${invite.role}${
        collaborator && "state" in collaborator ? ` (GitHub: ${collaborator.state})` : ""
      }`,
      outcome: "ok",
    });

    return NextResponse.json({
      ok: true,
      projectId: invite.projectId,
      projectName: invite.projectName,
      username: user.username,
      role: invite.role,
      githubUsername: githubUsername || null,
      githubInviteState: collaborator && "state" in collaborator ? collaborator.state : "none",
      githubError:
        collaborator && "error" in collaborator && collaborator.error
          ? collaborator.error
          : undefined,
    });
  } catch (err) {
    console.error("Invite acceptance failed:", err);
    return NextResponse.json(
      { error: "Failed to accept the invite: " + (err as Error).message },
      { status: 500 }
    );
  }
}
