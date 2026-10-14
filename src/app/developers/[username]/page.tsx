import type { Metadata } from "next";
import { DeveloperProfileView } from "@/components/DeveloperProfileView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Creator profile" };

export default async function DeveloperPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <DeveloperProfileView username={username} />;
}
