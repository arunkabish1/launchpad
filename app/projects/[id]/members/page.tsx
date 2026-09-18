import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/store";
import { getSessionUser } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import MembersPanel from "../../../components/members-panel";

export const dynamic = "force-dynamic";

export default async function ProjectMembersPage({
  params,
}: PageProps<"/projects/[id]/members">) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const project = await getProject(id);
  if (!project) notFound();

  const access = await requireProjectRole(user, id, "member");
  if (!access.ok) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center gap-1.5 text-xs text-slate-500">
        <Link href="/projects" className="transition-colors hover:text-[#f6821f]">
          Projects
        </Link>
        <span>/</span>
        <Link
          href={`/projects/${project.id}`}
          className="transition-colors hover:text-[#f6821f]"
        >
          {project.name}
        </Link>
        <span>/</span>
        <span className="text-slate-300">Members</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Members</h1>
        <p className="mt-1 text-sm text-slate-400">
          Who can access <span className="text-slate-200">{project.name}</span> in Launchpad and
          on GitHub.
        </p>
      </div>

      <MembersPanel
        projectId={project.id}
        projectName={project.name}
        role={access.role}
        canManage={access.role === "owner"}
      />
    </div>
  );
}
