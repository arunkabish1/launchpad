import { Suspense } from "react";
import { listTemplates } from "@/lib/templates";
import { getEnvPat, getDefaultAccountId, getOrgName, getAwsCredentialEnvVars } from "@/lib/config";
import LaunchPad from "./components/launch-pad";

export const dynamic = "force-dynamic";

export default async function Home() {
  const templates = listTemplates();
  const awsEnv = await getAwsCredentialEnvVars();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Launch an app to Cloudflare or AWS</h1>
        <p className="mt-1 text-sm text-slate-400">
          Choose a language, then a template. Launchpad scaffolds the project, creates a GitHub
          repo with deploy secrets, pushes the code, and GitHub Actions deploys it to Cloudflare or AWS.
        </p>
      </div>
      <Suspense
        fallback={<p className="text-sm text-slate-500">Loading launch pad…</p>}
      >
        <LaunchPad
          templates={templates}
          envPatSet={Boolean(await getEnvPat())}
          envTokenSet={Boolean(process.env.CLOUDFLARE_API_TOKEN)}
          defaultAccountId={await getDefaultAccountId()}
          envAwsAccessKeySet={Boolean((process.env[awsEnv.accessKeyEnv] ?? "").trim())}
          envAwsSecretKeySet={Boolean((process.env[awsEnv.secretKeyEnv] ?? "").trim())}
          org={await getOrgName()}
        />
      </Suspense>
    </div>
  );
}
