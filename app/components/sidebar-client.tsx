"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

const SIDEBAR_STORAGE_KEY = "launchpad.sidebar.collapsed";
const SIDEBAR_EXPANDED_W = "16rem";
const SIDEBAR_COLLAPSED_W = "4.5rem";

const collapsedListeners = new Set<() => void>();

function getCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsed(callback: () => void): () => void {
  collapsedListeners.add(callback);
  return () => {
    collapsedListeners.delete(callback);
  };
}

function setCollapsedPersisted(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage may be unavailable; collapse still works for the session.
  }
  for (const cb of collapsedListeners) cb();
}

function ZapIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

export default function SidebarClient() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    () => false
  );

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W
    );
  }, [collapsed]);

  const navItems = [
    { href: "/", label: "Launch", icon: <ZapIcon /> },
    { href: "/projects", label: "Projects", icon: <GridIcon /> },
    { href: "/templates", label: "Templates", icon: <TemplateIcon /> },
  ];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const close = () => setOpen(false);

  const handleNavClick = () => {
    close();
    setCollapsedPersisted(true);
  };

  const navLinkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      collapsed
        ? "lg:justify-center lg:gap-0 lg:px-0"
        : ""
    } ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`;

  const labelClass = collapsed ? "lg:hidden" : "";

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Logout is best-effort; navigate anyway.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-slate-800/80 bg-slate-950/80 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-md border border-slate-700 p-1.5 text-slate-300 hover:border-slate-500"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#f6821f] text-[10px] font-bold text-slate-950">
            CF
          </span>
          Cloudflare Launchpad
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={close} aria-hidden />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-800/80 bg-slate-950/90 transition-[transform,width] duration-200 lg:w-[var(--sidebar-w)] lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div
          className={`flex items-center justify-between px-5 py-5 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
        >
          <Link href="/" onClick={handleNavClick} className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[#f6821f] text-xs font-bold text-slate-950">
              CF
            </span>
            <span className={labelClass}>Cloudflare Launchpad</span>
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="rounded-md p-1 text-slate-400 hover:text-slate-200 lg:hidden"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={handleNavClick}
              title={collapsed ? item.label : undefined}
              className={navLinkClass(isActive(item.href))}
            >
              {item.icon}
              <span className={labelClass}>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-800/80 px-3 py-3">
          <Link
            href="/settings"
            onClick={handleNavClick}
            title={collapsed ? "Settings" : undefined}
            className={navLinkClass(pathname.startsWith("/settings"))}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            <span className={labelClass}>Settings</span>
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            title={collapsed ? "Log out" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              collapsed ? "lg:justify-center lg:gap-0 lg:px-0" : ""
            } text-slate-400 hover:bg-slate-900 hover:text-slate-100`}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            <span className={labelClass}>Log out</span>
          </button>
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsedPersisted(false)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="absolute -right-3 top-1/2 z-10 hidden h-16 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-slate-700 bg-slate-800 text-slate-300 shadow-lg transition-colors hover:border-[#f6821f]/60 hover:text-[#ff9436] lg:flex"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </aside>
    </>
  );
}
