import type { Metadata } from "next";
import { Studio } from "@/components/Studio";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Studio" };

export default function StudioPage() {
  return <Studio />;
}
