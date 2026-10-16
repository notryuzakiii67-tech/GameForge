"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, Mail, ShieldCheck } from "lucide-react";

type Step = "request" | "code" | "reset" | "done";

export function AccountRecoveryForm() {
  const [step, setStep] = useState<Step>("request");
  const [identifier, setIdentifier] = useState("");
  const [requestId, setRequestId] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (step === "request") {
        const response = await fetch("/api/auth/recovery/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "Recovery is unavailable. Try again later.");
        setRequestId(result.requestId);
        setNotice(result.message);
        setStep("code");
        return;
      }
      if (step === "code") {
        const response = await fetch("/api/auth/recovery/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, code }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "That code is invalid or expired.");
        setResetToken(result.resetToken);
        setStep("reset");
        return;
      }
      if (step === "reset") {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const response = await fetch("/api/auth/recovery/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resetToken, password, confirmPassword }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "We couldn’t reset that password.");
        setResetToken("");
        setPassword("");
        setConfirmPassword("");
        setStep("done");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t complete account recovery.");
    } finally {
      setBusy(false);
    }
  }

  const title = step === "request" ? "Recover your account" : step === "code" ? "Check for a recovery code" : step === "reset" ? "Choose a new password" : "Password updated";

  return <div className="recovery-shell page-wrap">
    <Link className="brand recovery-brand" href="/"><span className="brand-mark"><ShieldCheck size={16} /></span><span className="brand-name">gameforge<span className="brand-period">.</span></span></Link>
    <section className="panel-card recovery-card">
      <div className="recovery-icon">{step === "done" ? <CheckCircle2 size={22} /> : <Mail size={22} />}</div>
      <div className="eyebrow eyebrow-small">ACCOUNT RECOVERY</div>
      <h1>{title}</h1>
      {step === "request" && <p>Enter your username or verified email. If the account has a verified recovery email, we’ll send a one-time code. We never reveal whether an account exists.</p>}
      {step === "code" && <p>{notice || "If an account with a verified recovery email exists and delivery succeeds, it will receive a one-time code."} Check your inbox and spam folder. Codes expire in 10 minutes.</p>}
      {step === "reset" && <p>Choose a strong password that you haven’t used on GameForge before. Existing sessions will be signed out.</p>}
      {step === "done" && <p>Your password was changed and existing sessions were revoked. Sign in with your username and new password.</p>}
      {error && <div className="notice notice-error recovery-notice" role="alert">{error}</div>}
      {step === "done" ? <Link className="button button-primary recovery-action" href="/auth?mode=login">Back to sign in <ArrowRight size={14} /></Link> : <form onSubmit={submit}>
        {step === "request" && <div className="field"><label htmlFor="recovery-identifier">Username or verified email</label><input id="recovery-identifier" className="text-input" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} minLength={3} maxLength={254} required /></div>}
        {step === "code" && <div className="field"><label htmlFor="recovery-code">Six-digit code</label><input id="recovery-code" className="text-input recovery-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>}
        {step === "reset" && <>
          <div className="field"><label htmlFor="new-recovery-password">New password <small>12 minimum · 72-byte bcrypt limit</small></label><div className="password-input"><input id="new-recovery-password" className="text-input" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide new password" : "Show new password"}>{showPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></div>
          <div className="field"><label htmlFor="confirm-recovery-password">Confirm new password</label><input id="confirm-recovery-password" className="text-input" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
        </>}
        <button className="button button-primary recovery-action" disabled={busy}>{busy ? <><LoaderCircle size={14} className="spin" /> Working…</> : <>{step === "request" ? "Send recovery code" : step === "code" ? "Verify code" : "Save new password"} <ArrowRight size={14} /></>}</button>
      </form>}
      {step !== "done" && <Link className="recovery-back-link" href="/auth?mode=login"><ArrowLeft size={12} /> Back to sign in</Link>}
      <p className="recovery-safety-note">Automatic recovery is possible only through an email address that was verified before the request. An unverified address or username alone cannot reset an account.</p>
    </section>
  </div>;
}
