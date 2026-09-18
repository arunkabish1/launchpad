import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/store";
import { getTemplate, templateStack } from "@/lib/templates";
import { deriveLiveUrl } from "@/lib/cf";
import { resolvePat, getProjectStatus, resolveProjectLiveUrl } from "@/lib/status";
import { getSessionUser } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import ProjectPanel from "../../components/project-panel";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const project = await getProject(id);
  if (!project) notFound();

  const access = await requireProjectRole(user, id, "member");
  if (!access.ok) notFound();

  const template = getTemplate(project.templateId);

  const liveUrl = (await resolveProjectLiveUrl(project).catch(() => null)) ?? deriveLiveUrl(project);

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
      liveUrl={liveUrl}
      initialStatus={initialStatus}
      initialError={statusError}
      role={access.role}
    />
  );
}
