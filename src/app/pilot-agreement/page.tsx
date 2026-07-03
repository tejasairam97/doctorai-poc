import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DoctorAI Pilot Agreement",
  description: "Draft DoctorAI pilot agreement for clinic evaluation."
};

const effectiveDate = "July 3, 2026";

const sections = [
  {
    title: "1. Parties",
    body: [
      "This draft pilot agreement is between DoctorAI / provider entity placeholder and the participating clinic or doctor placeholder."
    ]
  },
  {
    title: "2. Pilot Purpose",
    body: [
      "The purpose of the pilot is to evaluate DoctorAI's AI documentation workflow and collect feedback from participating doctors or clinics."
    ]
  },
  {
    title: "3. Pilot Term",
    body: [
      "The default pilot term is 30-60 days unless extended in writing by both parties."
    ]
  },
  {
    title: "4. Fees",
    body: [
      "The pilot is free during the pilot term unless the parties agree otherwise in writing."
    ]
  },
  {
    title: "5. Service Scope",
    body: [
      "DoctorAI may support recording or dictating consultations, generating draft summaries, doctor review and approval, and secure patient access to approved summaries."
    ]
  },
  {
    title: "6. Doctor or Clinic Responsibilities",
    body: [
      "The doctor or clinic is responsible for obtaining patient recording consent where required, reviewing and approving summaries before using or sharing them, avoiding emergency use, and not relying on AI output as medical judgment."
    ]
  },
  {
    title: "7. PHI and HIPAA",
    body: [
      "If the clinic is a HIPAA covered entity and protected health information is processed, a Business Associate Agreement should be executed where applicable.",
      "If a Business Associate Agreement is signed, it controls protected health information obligations for the pilot."
    ]
  },
  {
    title: "8. Feedback",
    body: [
      "The doctor or clinic may provide feedback about the pilot. DoctorAI may use non-identifiable feedback to improve the product. Feedback should avoid unnecessary patient identifiers."
    ]
  },
  {
    title: "9. Data Handling",
    body: [
      "Patients see approved summaries only. Raw transcripts and draft summaries are not shown to patients. The normal DoctorAI workflow does not store raw audio at rest for long-term retention."
    ]
  },
  {
    title: "10. Confidentiality",
    body: [
      "Each party should protect non-public pilot information received from the other party and use it only for evaluating or operating the pilot."
    ]
  },
  {
    title: "11. Termination",
    body: [
      "Either party may stop participating in the pilot. The parties should coordinate any reasonable transition, export, or deletion requests consistent with applicable agreements and law."
    ]
  },
  {
    title: "12. Disclaimers",
    body: [
      "DoctorAI is a pilot and beta service. It supports doctor-reviewed documentation workflows and is not medical advice."
    ]
  },
  {
    title: "13. Signatures",
    body: [
      "DoctorAI / provider entity placeholder: name, title, signature, and date.",
      "Clinic / doctor placeholder: name, title, signature, and date."
    ]
  }
];

export default function PilotAgreementPage() {
  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link className="inline-flex rounded-full bg-white px-3 py-2 text-sm font-bold text-moss shadow-soft" href="/">
          Back to DoctorAI
        </Link>
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-soft sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-moss">Draft agreement</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">DoctorAI Pilot Agreement</h1>
          <p className="mt-2 text-sm font-semibold text-ink/65">Effective date: {effectiveDate}</p>
          <p className="mt-4 rounded-xl bg-clinic p-3 text-sm font-semibold leading-relaxed text-ink/75">
            This is a practical draft for pilot conversations. It does not create an in-app acceptance requirement and
            should be reviewed and finalized before signature.
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
