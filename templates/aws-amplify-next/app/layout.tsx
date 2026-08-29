import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launchpad Next.js",
  description: "Next.js on AWS Amplify",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
