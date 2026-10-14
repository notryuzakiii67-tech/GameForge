import type { Metadata } from "next";
import { AiProjectPublicView } from "@/components/AiProjectPublicView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Game Project" };

export default async function AiProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AiProjectPublicView projectId={id} />;
}
