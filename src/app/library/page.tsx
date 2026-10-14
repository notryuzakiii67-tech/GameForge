import type { Metadata } from "next";
import { LibraryBrowser } from "@/components/LibraryBrowser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Library" };

export default function LibraryPage() {
  return <LibraryBrowser />;
}
