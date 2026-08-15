import { getConfigStatus } from "@/lib/config";
import SettingsPanel from "../components/settings-panel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getConfigStatus();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Server configuration and security status.
        </p>
      </div>

      <SettingsPanel initialStatus={status} />
    </div>
  );
}
