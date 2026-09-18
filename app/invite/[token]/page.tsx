import InviteAcceptForm from "../../components/invite-accept-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-[#f6821f] text-sm font-bold text-slate-950">
            CF
          </span>
          <h1 className="mt-3 text-xl font-semibold text-white">Join a project</h1>
          <p className="mt-1 text-sm text-slate-400">
            Accept your invite to Cloudflare Launchpad.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <InviteAcceptForm token={token} />
        </div>
      </div>
    </div>
  );
}
