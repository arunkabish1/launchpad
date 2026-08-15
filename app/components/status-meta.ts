import type { ProjectStatus } from "@/lib/types";

export interface StatusMeta {
  label: string;
  className: string;
  dotClass: string;
  pulse?: boolean;
}

const META: Record<string, StatusMeta> = {
  queued: {
    label: "Queued",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    dotClass: "bg-amber-400",
  },
  running: {
    label: "Deploying",
    className: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    dotClass: "bg-sky-400",
    pulse: true,
  },
  success: {
    label: "Deployed",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dotClass: "bg-emerald-400",
  },
  failure: {
    label: "Failed",
    className: "bg-red-500/15 text-red-300 border-red-500/30",
    dotClass: "bg-red-400",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    dotClass: "bg-slate-400",
  },
  "no-runs": {
    label: "No deploys yet",
    className: "bg-slate-500/15 text-slate-400 border-slate-600/40",
    dotClass: "bg-slate-600",
  },
  unknown: {
    label: "Unknown",
    className: "bg-slate-500/15 text-slate-400 border-slate-600/40",
    dotClass: "bg-slate-600",
  },
};

export function getStatusMeta(status: ProjectStatus | string | undefined): StatusMeta {
  return META[status ?? "unknown"] ?? META.unknown;
}
