import type { Metadata } from "next";
import { AccountRecoveryForm } from "@/components/AccountRecoveryForm";

export const metadata: Metadata = { title: "Recover your account" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <AccountRecoveryForm />;
}
