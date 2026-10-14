import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GameForge — Play. Create. Publish. Discover.",
    template: "%s · GameForge",
  },
  description: "Discover indie browser games, play instantly, and turn an idea into a playable game with AI.",
  applicationName: "GameForge",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://gameforge.vercel.app"),
  openGraph: {
    title: "GameForge — Play. Create. Publish. Discover.",
    description: "A home for small games and big ideas.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0c12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><AppShell>{children}</AppShell></body></html>;
}
