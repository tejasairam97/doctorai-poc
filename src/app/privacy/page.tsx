import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DoctorAI Privacy Policy",
  description: "Draft DoctorAI privacy policy for pilot users."
};

const effectiveDate = "July 3, 2026";

const sections = [
  {
    title: "Overview",
    body: [
      "DoctorAI is an AI clinical documentation assistant for outpatient-style visits. It helps doctors record or dictate consultation information, generate draft summaries, approve final summaries, and securely share approved summaries with patients."
    ]
  },
  {
    title: "Information We Collect",
    body: [
      "Doctor account information, including name, email, and password or authentication details.",
      "Patient visit information entered by a doctor, including patient name, age, email, and optional phone number.",
      "Consultation documentation, including transcript text, doctor self-summary text, AI draft summaries, and approved final summaries.",
      "Consent status, email delivery status, and technical or security logs needed to operate, secure, troubleshoot, and improve service reliability."
    ]
  },
  {
    title: "How We Use Information",
    body: [
      "We use information to provide the service, generate draft clinical summaries, allow doctors to review and approve summaries, send secure summary links when allowed, and maintain security, auditability, troubleshooting, and reliability."
    ]
  },
  {
    title: "AI Processing",
    body: [
      "AI-generated summaries are draft documentation only. Doctors must review and approve summaries before patients can view them.",
      "Patients are not shown raw transcripts or draft summaries. DoctorAI is not used to make diagnoses or treatment decisions."
    ]
  },
  {
    title: "PHI and HIPAA",
    body: [
      "DoctorAI may process protected health information when used by healthcare providers. For providers or clinics subject to HIPAA, DoctorAI expects to operate as a Business Associate under a Business Associate Agreement where applicable.",
      "If a Business Associate Agreement is signed, that agreement governs protected health information handling where it conflicts with this general policy language."
    ]
  },
  {
    title: "Data Sharing",
    body: [
      "We may use service providers and subprocessors to host, secure, transmit, and operate the app. We do not sell patient data, and patient data is not used for advertising."
    ]
  },
  {
    title: "Data Retention",
    body: [
      "We keep visit documentation while the doctor or account requires the service, unless deletion is requested or required. The normal DoctorAI workflow does not store raw audio at rest for long-term retention."
    ]
  },
  {
    title: "Security",
    body: [
      "DoctorAI uses encryption in transit, hosted cloud infrastructure, access controls, and OTP verification for patient access. Doctors are responsible for protecting their login credentials and using the service appropriately."
    ]
  },
  {
    title: "Patient Access",
    body: [
      "Patients can access approved summaries only through secure email and OTP flows. Patients do not receive access to raw transcripts or draft summaries."
    ]
  },
  {
    title: "Contact",
    body: ["Questions about this draft policy can be sent to privacy@doctorai.app."]
  }
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link className="inline-flex rounded-full bg-white px-3 py-2 text-sm font-bold text-moss shadow-soft" href="/">
          Back to DoctorAI
        </Link>
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-soft sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-moss">Draft policy</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">DoctorAI Privacy Policy</h1>
          <p className="mt-2 text-sm font-semibold text-ink/65">Effective date: {effectiveDate}</p>
          <p className="mt-4 rounded-xl bg-clinic p-3 text-sm font-semibold leading-relaxed text-ink/75">
            This page is a draft startup and pilot privacy policy. It is intended for review and should be finalized
            with counsel before broad production use.
          </p>
        </section>

        <div className="mt-4 space-y-3">
          {sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-mint bg-white p-5 shadow-soft">
              <h2 className="text-lg font-bold text-ink">{section.title}</h2>
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink/75">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
