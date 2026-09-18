import { listProjects } from "@/lib/store";
import { deriveLiveUrl } from "@/lib/cf";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { filterAccessibleProjects } from "@/lib/membership";
import Link from "next/link";
import ProjectsTable, { type TableProject } from "../components/projects-table";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const projects = (
    await filterAccessibleProjects(user, await listProjects())
  ).map<TableProject>((p) => ({
    ...p,
    liveUrl: deriveLiveUrl(p),
  }));

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">
            Apps launched through this Launchpad, with their latest deploy status.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436]"
        >
          + New launch
        </Link>
      </div>

      <ProjectsTable projects={projects} />
    </div>
  );
}
