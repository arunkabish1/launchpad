import { listTemplates } from "@/lib/templates";
import Link from "next/link";
import TemplatesBrowser from "../components/templates-browser";

export const dynamic = "force-dynamic";

export default function TemplatesPage() {
  const templates = listTemplates();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Templates</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every stack available on this Launchpad. Open a template to see its full details.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md bg-[#f6821f] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ff9436]"
        >
          + New launch
        </Link>
      </div>

      <TemplatesBrowser templates={templates} />
    </div>
  );
}
