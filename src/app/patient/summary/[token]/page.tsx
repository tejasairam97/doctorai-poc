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
    <main className="min-h-screen px-4 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Link className="text-sm font-bold text-moss" href="/">
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
        <section className="rounded-lg border border-mint bg-white p-5 shadow-soft">
          <p className="text-xs font-bold uppercase text-coral">Link unavailable</p>
          <h1 className="mt-2 text-2xl font-bold text-ink">This summary link cannot be opened</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink/75">
            The link may be invalid, replaced, or no longer connected to an approved visit summary.
          </p>
          <Link
            className="mt-5 inline-flex w-full justify-center rounded-md bg-moss px-4 py-3 text-sm font-bold text-white"
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
        <section className="rounded-lg border border-mint bg-white p-5 shadow-soft">
          <p className="text-xs font-bold uppercase text-coral">Expired link</p>
          <h1 className="mt-2 text-2xl font-bold text-ink">This secure summary link has expired</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink/75">
            This link was for {access.maskedPatientEmail} and expired {formatDate(access.expiresAt)}. Please contact
            your clinician's office if you need access.
          </p>
          <Link
            className="mt-5 inline-flex w-full justify-center rounded-md bg-moss px-4 py-3 text-sm font-bold text-white"
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
      <section className="rounded-lg border border-mint bg-white p-5 shadow-soft">
        <p className="text-xs font-bold uppercase text-moss">Verified patient summary</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Your visit summary</h1>
        <div className="mt-4 grid gap-3 rounded-md bg-clinic p-4 text-sm text-ink/75">
          <p>
            <span className="font-bold text-ink">Doctor:</span> {access.visit.doctor.name} ({access.visit.doctor.email})
          </p>
          <p>
            <span className="font-bold text-ink">Visit date:</span>{" "}
            {formatDate(access.visit.approvedAt || access.visit.createdAt)}
          </p>
          <p>
            <span className="font-bold text-ink">Link expires:</span> {formatDate(access.expiresAt)}
          </p>
        </div>
        <div className="mt-5 whitespace-pre-wrap rounded-md border border-mint bg-white p-4 text-sm leading-relaxed text-ink">
          {access.visit.approvedSummary}
        </div>
        <Link
          className="mt-5 inline-flex w-full justify-center rounded-md border border-mint bg-white px-4 py-3 text-sm font-bold text-moss"
          href="/"
        >
          Open Patient Portal
        </Link>
      </section>
    </PageShell>
  );
}
