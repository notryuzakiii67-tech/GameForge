import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in or join" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const mode = params.mode === "register" ? "register" : "login";
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  return <AuthForm initialMode={mode} nextPath={next} />;
}
