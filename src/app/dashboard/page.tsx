import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Creator dashboard" };

export default function DashboardPage() {
  return <Dashboard />;
}
