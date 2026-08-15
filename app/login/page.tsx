import { Suspense } from "react";
import LoginForm from "../components/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-[#f6821f] text-sm font-bold text-slate-950">
            CF
          </span>
          <h1 className="mt-3 text-xl font-semibold text-white">Cloudflare Launchpad</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to launch apps.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
