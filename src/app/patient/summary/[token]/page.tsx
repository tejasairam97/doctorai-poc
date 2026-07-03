import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { PATIENT_SESSION_COOKIE_NAME } from "@/lib/otp";
import { getPatientSessionByToken, getPatientSummaryLinkAccess } from "@/lib/store";
import { SummaryLinkOtpPanel } from "./summary-link-otp-panel";

export const dynamic = "force-dynamic";

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:py-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Link className="w-fit rounded-full bg-white px-3 py-2 text-sm font-bold text-moss shadow-soft" href="/">
          DoctorAI
        </Link>
        {children}
      </div>
    </main>
  );
}

export default async function PatientSummaryLinkPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cookieStore = await cookies();
  const patientSession = await getPatientSessionByToken(cookieStore.get(PATIENT_SESSION_COOKIE_NAME)?.value);
  const access = await getPatientSummaryLinkAccess({
    token,
    patientSessionEmail: patientSession?.email
  });

  if (access.status === "invalid") {
    return (
      <PageShell>
        <section className="rounded-2xl border border-mint bg-white p-5 shadow-soft">
          <p className="text-xs font-bold uppercase text-coral">Link unavailable</p>
          <h1 className="mt-2 text-2xl font-bold text-ink">This summary link is invalid.</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink/75">
            Please check the link or ask your clinic to send a new secure summary link.
          </p>
          <Link
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-moss px-4 py-3 text-sm font-bold text-white"
            href="/"
          >
            Go to Patient Access
          </Link>
        </section>
      </PageShell>
    );
  }

  if (access.status === "expired") {
    return (
      <PageShell>
        <section className="rounded-2xl border border-mint bg-white p-5 shadow-soft">
          <p className="text-xs font-bold uppercase text-coral">Expired link</p>
          <h1 className="mt-2 text-2xl font-bold text-ink">This summary link has expired.</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink/75">
            This link was for {access.maskedPatientEmail} and expired {formatDate(access.expiresAt)}. Please ask your
            clinic to resend it.
          </p>
          <Link
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-moss px-4 py-3 text-sm font-bold text-white"
            href="/"
          >
            Go to Patient Access
          </Link>
        </section>
      </PageShell>
    );
  }

  if (access.status === "verification_required") {
    return (
      <PageShell>
        <SummaryLinkOtpPanel
          token={token}
          maskedPatientEmail={access.maskedPatientEmail}
          expiresAtLabel={formatDate(access.expiresAt)}
          hasMismatchedSession={Boolean(access.sessionEmail)}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className="rounded-2xl border border-mint bg-white p-5 shadow-soft">
        <p className="text-xs font-bold uppercase text-moss">Verified patient summary</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Your visit summary is ready</h1>
        <div className="mt-4 grid gap-3 rounded-2xl bg-clinic p-4 text-sm text-ink/75">
          <div>
            <p className="text-xs font-bold uppercase text-moss">Doctor</p>
            <p className="mt-1 font-bold text-ink">{access.visit.doctor.name}</p>
            <p className="break-all text-xs font-semibold text-ink/60">{access.visit.doctor.email}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-moss">Visit date</p>
            <p className="mt-1 font-bold text-ink">{formatDate(access.visit.approvedAt || access.visit.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-moss">Link expires</p>
            <p className="mt-1 font-bold text-ink">{formatDate(access.expiresAt)}</p>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-mint bg-clinic p-4">
          <p className="text-xs font-bold uppercase text-moss">Approved summary</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{access.visit.approvedSummary}</p>
        </div>
        <Link
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-mint bg-white px-4 py-3 text-sm font-bold text-moss"
          href="/"
        >
          View all my visits
        </Link>
      </section>
    </PageShell>
  );
}
