import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { AiGalleryBrowser } from "@/components/AiGalleryBrowser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Game Gallery" };

export default function AiGalleryPage() {
  return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><Sparkles size={13} /> MADE IN GAMEFORGE</div><h1>Small worlds, big imagination.</h1><p>Browse public games built in the AI Studio. Every project here was shared by its creator and approved for the gallery.</p></header><AiGalleryBrowser /></div>;
}
