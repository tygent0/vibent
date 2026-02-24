import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "vibent",
  description: "git + x-ray vision for AI-assisted coding"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/signin">Sign in</Link>
            <Link href="/connect">Connect repos</Link>
            <Link href="/runs">Runs</Link>
            <a href="/sessions">Sessions</a>
            <a href="/docs">Docs</a>
            <Link href="/publish">Publish</Link>
            <Link href="/settings">Settings</Link>
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
