import { NextRequest, NextResponse } from "next/server";
import { getInviteByToken, inviteState } from "@/lib/invites";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/invites/[token]">) {
  const { token } = await ctx.params;
  const invite = await getInviteByToken(token);
  if (!invite) {
    return NextResponse.json({ error: "This invite link is invalid." }, { status: 404 });
  }
  const state = inviteState(invite);
  return NextResponse.json({
    projectName: invite.projectName,
    role: invite.role,
    state,
  });
}
