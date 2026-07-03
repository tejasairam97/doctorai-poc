import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DoctorAI Terms of Use",
  description: "Draft DoctorAI terms of use for pilot users."
};

const effectiveDate = "July 3, 2026";

const sections = [
  {
    title: "Acceptance",
    body: [
      "By using DoctorAI, you agree to these Terms of Use. If you use DoctorAI for a clinic, medical practice, or other organization, you represent that you are authorized to use the service for that organization."
    ]
  },
  {
    title: "Service Description",
    body: [
      "DoctorAI is an AI documentation helper for doctors. It supports recording or dictation workflows, draft summary generation, doctor review and approval, and secure patient access to approved summaries."
    ]
  },
  {
    title: "Pilot and Beta Nature",
    body: [
      "DoctorAI may be offered as a free pilot. Features may change, be limited, or be discontinued as the product is evaluated and improved."
    ]
  },
  {
    title: "Clinical Responsibility",
    body: [
      "The doctor or healthcare provider remains solely responsible for clinical judgment, diagnosis, treatment, patient communication, and medical record decisions.",
      "Every AI-generated summary must be reviewed and approved by the doctor before it is relied on or shared."
    ]
  },
  {
    title: "Not for Emergencies",
    body: [
      "DoctorAI is not for emergencies, urgent medical advice, or time-sensitive clinical decisions. Patients should contact emergency services or their healthcare provider for urgent needs."
    ]
  },
  {
    title: "No Medical Advice from DoctorAI",
    body: [
      "DoctorAI does not provide medical advice, diagnosis, or treatment decisions. It supports doctor-reviewed documentation workflows."
    ]
  },
  {
    title: "Consent Obligations",
    body: [
      "The doctor or clinic is responsible for obtaining patient consent for recording where required by law, policy, or professional standards."
    ]
  },
  {
    title: "Account Responsibilities",
    body: [
      "Users must keep login credentials secure, promptly report unauthorized access, and use the service only for appropriate documentation workflows."
    ]
  },
  {
    title: "Acceptable Use",
    body: [
      "Users may not misuse the service, attempt unauthorized access, reverse engineer the service, abuse email or OTP flows, upload illegal content, or interfere with service operations."
    ]
  },
  {
    title: "Data and Privacy",
    body: [
      "Use of DoctorAI is also governed by the Privacy Policy. Where applicable, a Business Associate Agreement may govern protected health information handling."
    ]
  },
  {
    title: "Availability",
    body: [
      "During the pilot, DoctorAI does not guarantee uninterrupted access. Maintenance, provider outages, network issues, or product changes may affect availability."
    ]
  },
  {
    title: "Limitation of Liability",
    body: [
      "To the extent allowed by law, DoctorAI is not responsible for indirect, incidental, consequential, special, or punitive damages. The service is provided for pilot evaluation and doctor-reviewed documentation support."
    ]
  },
  {
    title: "Changes",
    body: [
      "DoctorAI may update these terms as the product changes. Continued use after changes means you accept the updated terms."
    ]
  },
  {
    title: "Contact",
    body: ["Questions about these draft terms can be sent to support@doctorai.app."]
  }
];

export default function TermsPage() {
  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link className="inline-flex rounded-full bg-white px-3 py-2 text-sm font-bold text-moss shadow-soft" href="/">
          Back to DoctorAI
        </Link>
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-soft sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-moss">Draft terms</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">DoctorAI Terms of Use</h1>
          <p className="mt-2 text-sm font-semibold text-ink/65">Effective date: {effectiveDate}</p>
          <p className="mt-4 rounded-xl bg-clinic p-3 text-sm font-semibold leading-relaxed text-ink/75">
            These draft terms are intended for pilot review and should be finalized with counsel before broad
            production use.
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
