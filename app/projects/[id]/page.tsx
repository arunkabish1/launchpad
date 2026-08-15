import { notFound } from "next/navigation";
import { getProject } from "@/lib/store";
import { getTemplate, templateStack } from "@/lib/templates";
import { deriveLiveUrl } from "@/lib/cf";
import { resolvePat, getProjectStatus } from "@/lib/status";
import ProjectPanel from "../../components/project-panel";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  const template = getTemplate(project.templateId);

  const pat = await resolvePat(project.id);
  let initialStatus: Awaited<ReturnType<typeof getProjectStatus>> | null = null;
  let statusError: string | null = null;

  if (pat) {
    try {
      initialStatus = await getProjectStatus(project.owner, project.repo, pat);
    } catch (err) {
      statusError = (err as Error).message;
    }
  } else {
    statusError = "No GitHub token available for this project (set GITHUB_PAT in .env).";
  }

  return (
    <ProjectPanel
      project={project}
      template={{
        name: template?.name ?? project.templateName,
        source: template?.source ?? "local",
        stack: template ? templateStack(template) : project.type,
        buildCommand: template?.buildCommand ?? "",
        setup: template?.deploy?.setup ?? "",
        deployCommand: template?.deploy?.command ?? template?.deployCommand ?? "deploy",
        requiresRoute: template?.requiresRoute ?? false,
        fileCount: template?.files.length ?? 0,
      }}
      liveUrl={deriveLiveUrl(project)}
      initialStatus={initialStatus}
      initialError={statusError}
    />
  );
}
