import type { Metadata } from "next";
import { Studio } from "@/components/Studio";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project Studio" };

export default async function ProjectStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio initialProjectId={id} />;
}
