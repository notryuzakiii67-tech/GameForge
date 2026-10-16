"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Mail, ShieldCheck } from "lucide-react";

type AccountRecovery = {
  username: string;
  email: string | null;
  emailVerified: boolean;
  maskedEmail: string | null;
  phone: string | null;
  phoneVerified: boolean;
  phoneRecoveryEnabled: boolean;
};

export function AccountRecoverySettings() {
  const [account, setAccount] = useState<AccountRecovery | null>(null);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [requestId, setRequestId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAccount() {
    const response = await fetch("/api/account/recovery", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Could not load recovery settings.");
    setAccount(result);
    setEmail((current) => current || result.email || "");
  }

  useEffect(() => {
    let active = true;
    fetch("/api/account/recovery", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Could not load recovery settings.");
      if (active) { setAccount(result); setEmail(result.email || ""); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load recovery settings."); });
    return () => { active = false; };
  }, []);

  async function startVerification(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/account/recovery/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, currentPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Could not send an email verification code.");
      setRequestId(result.requestId);
      setCurrentPassword("");
      setNotice(`A verification code was sent to ${result.maskedEmail}. It expires in 10 minutes.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send an email verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/account/recovery/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "That code is invalid or expired.");
      setRequestId("");
      setCode("");
      setNotice(`Recovery email ${result.email} is now verified.`);
      await loadAccount();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify this email.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel-card account-recovery-settings">
    <div className="card-title-with-icon"><span><ShieldCheck size={15} /></span><h2>Account recovery</h2></div>
    <p>Add a verified email so you can reset your password. Changes require your current password; a new address is not active for recovery until its code is confirmed.</p>
    {account && <div className="recovery-contact-status"><Mail size={14} /><div><strong>{account.emailVerified ? "Verified recovery email" : account.email ? "Email not verified" : "No verified recovery email"}</strong><span>{account.emailVerified ? account.maskedEmail : account.email ? `${account.email} · not usable for recovery` : "Password recovery is unavailable until you verify an email."}</span></div>{account.emailVerified && <CheckCircle2 size={14} />}</div>}
    {error && <div className="notice notice-error recovery-settings-notice" role="alert">{error}</div>}
    {notice && <div className="notice notice-success recovery-settings-notice" role="status">{notice}</div>}
    {!requestId ? <form onSubmit={startVerification} className="recovery-contact-form">
      <div className="field"><label htmlFor="recovery-email">Email address</label><input id="recovery-email" className="text-input" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></div>
      <div className="field"><label htmlFor="recovery-current-password">Current password</label><input id="recovery-current-password" className="text-input" type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
      <button className="button button-primary button-small" disabled={busy || !account}>{busy ? <><LoaderCircle size={13} className="spin" /> Sending…</> : "Send verification code"}</button>
    </form> : <form onSubmit={verifyEmail} className="recovery-contact-form">
      <div className="field"><label htmlFor="recovery-email-code">Six-digit code</label><input id="recovery-email-code" className="text-input recovery-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>
      <div className="form-actions"><button className="button button-primary button-small" disabled={busy}>{busy ? "Checking…" : "Verify email"}</button><button type="button" className="button button-dark button-small" onClick={() => { setRequestId(""); setCode(""); setNotice(""); }}>Start over</button></div>
    </form>}
    <div className="recovery-sms-note"><strong>Phone recovery</strong><span>{account?.phoneVerified && account.phoneRecoveryEnabled ? "A verified phone is available." : "SMS recovery is not enabled; no SMS provider has been configured and tested."}</span></div>
  </section>;
}
