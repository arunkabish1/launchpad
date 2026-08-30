import { NextRequest, NextResponse } from "next/server";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { analyseImport, ImportError } from "@/lib/import";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: { url?: string; githubPat?: string };
  try {
    body = (await req.json()) as { url?: string; githubPat?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.url?.trim()) {
    return NextResponse.json({ error: "A GitHub repository URL is required." }, { status: 400 });
  }

  try {
    const analysis = await analyseImport({
      url: body.url,
      githubPat: body.githubPat,
    });
    return NextResponse.json({ analysis });
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Import analysis failed:", err);
    return NextResponse.json(
      { error: "Analysis failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
