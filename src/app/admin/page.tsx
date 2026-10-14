import type { Metadata } from "next";
import { AdminConsole } from "@/components/AdminConsole";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Moderation" };

export default function AdminPage() {
  return <AdminConsole />;
}
