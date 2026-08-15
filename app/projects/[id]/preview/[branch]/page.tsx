import { notFound } from "next/navigation";
import { getProject } from "@/lib/store";
import PreviewBranchClient from "@/app/components/preview-branch-client";

export const dynamic = "force-dynamic";

export default async function PreviewBranchPage({ params }: PageProps<"/projects/[id]/preview/[branch]">) {
  const { id, branch } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  if (project.type !== "worker") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#060d1a] p-8">
        <div className="max-w-md text-center">
          <p className="text-sm text-slate-400">
            Per-branch preview deployments are not yet supported for Pages projects.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PreviewBranchClient
      projectId={project.id}
      branch={branch}
    />
  );
}
