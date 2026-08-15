import { notFound } from "next/navigation";
import { getProject } from "@/lib/store";
import LiveLogsPageClient from "@/app/components/live-logs-page-client";

export const dynamic = "force-dynamic";

export default async function LiveLogsPage({ params }: PageProps<"/projects/[id]/live-logs">) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  if (project.type !== "worker") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#060d1a] p-8">
        <div className="max-w-md text-center">
          <p className="text-slate-400 text-sm">
            Live logs are only available for Workers projects. Pages projects do not support live
            tailing yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LiveLogsPageClient
      projectId={project.id}
      projectName={project.name}
    />
  );
}
