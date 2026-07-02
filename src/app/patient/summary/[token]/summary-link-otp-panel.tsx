"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type SummaryLinkOtpPanelProps = {
  token: string;
  maskedPatientEmail: string;
  expiresAtLabel: string;
  hasMismatchedSession: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data as T;
}

export function SummaryLinkOtpPanel({
  token,
  maskedPatientEmail,
  expiresAtLabel,
  hasMismatchedSession
}: SummaryLinkOtpPanelProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"READY" | "CODE">("READY");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      await api<{ ok: boolean; message: string }>(`/api/patient/summary/${encodeURIComponent(token)}/otp/request`, {
        method: "POST"
      });
      setStep("CODE");
      setMessage("If this secure link is valid, a verification code has been sent.");
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Unable to request a verification code.");
    } finally {
      setIsBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError("Enter the 6-digit code.");
      return;
    }

    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      await api<{ verified: boolean }>(`/api/patient/summary/${encodeURIComponent(token)}/otp/verify`, {
        method: "POST",
        body: JSON.stringify({
          code: trimmedCode
        })
      });
      setMessage("Verified. Opening the summary...");
      router.replace(`/patient/summary/${encodeURIComponent(token)}`);
      router.refresh();
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Verification failed.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-mint bg-white p-5 shadow-soft">
      <p className="text-xs font-bold uppercase text-moss">Secure summary link</p>
      <h1 className="mt-2 text-2xl font-bold text-ink">Verify your email to view this summary</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/75">
        We'll send a verification code to the email address on file for this visit. For privacy, the visit summary
        stays hidden until that email is verified.
      </p>
      <p className="mt-3 rounded-md bg-clinic p-3 text-sm font-bold text-ink">Email on file: {maskedPatientEmail}</p>
      <p className="mt-2 text-xs font-semibold text-ink/60">Link expires {expiresAtLabel}.</p>

      {hasMismatchedSession && (
        <p className="mt-4 rounded-md bg-amberline/15 p-3 text-sm font-semibold text-ink">
          This browser is signed in with a different patient email. Verify the email for this visit to continue.
        </p>
      )}

      {step === "READY" ? (
        <form className="mt-5 space-y-4" onSubmit={requestOtp}>
          <button
            className="w-full rounded-md bg-moss px-4 py-3 text-sm font-bold text-white"
            type="submit"
            disabled={isBusy}
          >
            Send Verification Code
          </button>
        </form>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={verifyOtp}>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Verification code</span>
            <input
              className="mt-2 w-full rounded-md border border-mint bg-clinic px-3 py-3 text-base tracking-[0.25em] outline-none focus:border-moss"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
            />
          </label>
          <button
            className="w-full rounded-md bg-moss px-4 py-3 text-sm font-bold text-white"
            type="submit"
            disabled={isBusy}
          >
            Verify and Open Summary
          </button>
          <button
            className="w-full rounded-md border border-mint bg-white px-4 py-3 text-sm font-bold text-moss"
            type="button"
            onClick={() => {
              setStep("READY");
              setCode("");
              setMessage("");
              setError("");
            }}
            disabled={isBusy}
          >
            Send a New Code
          </button>
        </form>
      )}

      {message && <p className="mt-4 rounded-md bg-mint p-3 text-sm font-semibold text-ink">{message}</p>}
      {error && <p className="mt-4 rounded-md bg-coral p-3 text-sm font-semibold text-white">{error}</p>}
    </section>
  );
}
