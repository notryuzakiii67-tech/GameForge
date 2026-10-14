import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Hammer } from "lucide-react";
import { DevelopersBrowser } from "@/components/DevelopersBrowser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Developers" };

export default function DevelopersPage() {
  return <div className="page-wrap page-content"><header className="page-header page-header-row"><div><div className="eyebrow"><Hammer size={13} /> PEOPLE WHO MAKE GAMES</div><h1>Meet the makers.</h1><p>Follow independent creators, find your next favorite studio, and see what they’re building.</p></div><Link className="button button-primary" href="/dashboard">Create your developer profile <ArrowRight size={15} /></Link></header><DevelopersBrowser /></div>;
}
