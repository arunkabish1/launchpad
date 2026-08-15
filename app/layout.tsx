import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "./components/sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cloudflare Launchpad",
  description: "Scaffold projects, push to GitHub, and deploy to Cloudflare via GitHub Actions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="min-h-dvh">
          <Sidebar />
          <div className="lg:pl-[var(--sidebar-w,16rem)] transition-[padding] duration-200">
            <main className="pt-16 lg:pt-0">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
