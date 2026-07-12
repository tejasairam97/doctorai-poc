import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  approveVisitSummary,
  createDraftVisit,
  createPatientSummaryLinkForVisit,
  getPatientSummaryLinkAccess,
  getVisit,
  loginDoctor,
  recordEmailDelivery,
  saveDraftSummary,
  saveVisitTranscript,
  signUpDoctor
} from "./store";
import { cleanupIntegrationData, uniqueIntegrationId } from "@/test/integration-helpers";

describe("store integration", () => {
  const doctorEmails: string[] = [];
  const patientEmails: string[] = [];
  let id = "";
  let doctorEmail = "";
  let patientEmail = "";

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(() => {
    id = uniqueIntegrationId();
    doctorEmail = `doctor.integration.${id}@doctorai.test`;
    patientEmail = `patient.integration.${id}@doctorai.test`;
    doctorEmails.push(doctorEmail);
    patientEmails.push(patientEmail);
  });

  afterEach(async () => {
    await cleanupIntegrationData({ doctorEmails, patientEmails });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("signs up and logs in a doctor against the database", async () => {
    const doctor = await signUpDoctor(" Dr. Integration ", doctorEmail.toUpperCase(), "pass-123");

    expect(doctor.email).toBe(doctorEmail);
    expect(doctor.name).toBe("Dr. Integration");
    await expect(signUpDoctor("Duplicate Doctor", doctorEmail, "pass-123")).rejects.toThrow(
      "An account with this email already exists."
    );

    const loggedIn = await loginDoctor(doctorEmail.toUpperCase(), "pass-123");
    const failedLogin = await loginDoctor(doctorEmail, "wrong-password");

    expect(loggedIn?.id).toBe(doctor.id);
    expect(failedLogin).toBeNull();
  });

  it("creates, updates, approves, and emails a visit with usage events", async () => {
    const doctor = await signUpDoctor("Dr. Visit Flow", doctorEmail, "pass-123");

    const draft = await createDraftVisit({
      doctorId: doctor.id,
      patient: {
        name: "Patient Placeholder",
        age: 42,
        email: patientEmail.toUpperCase(),
        phone: " 555-0100 "
      },
      consentStatus: "DENIED",
      inputModeRequested: "LIVE_CONVERSATION"
    });

    expect(draft.patient.email).toBe(patientEmail);
    expect(draft.patient.phone).toBe("555-0100");
    expect(draft.inputModeActual).toBe("DOCTOR_SELF_SUMMARY");
    expect(draft.status).toBe("DRAFT");

    const transcript = await saveVisitTranscript({
      visitId: draft.id,
      transcriptText: "Doctor self-summary placeholder: cough improving, continue monitoring.",
      inputModeActual: "DOCTOR_SELF_SUMMARY"
    });
    expect(transcript.status).toBe("READY_FOR_DOCUMENTATION");
    expect(transcript.transcriptLastSavedAt).toBeInstanceOf(Date);

    const summarized = await saveDraftSummary({
      visitId: draft.id,
      normalizedTranscriptText: "Doctor: cough improving, continue monitoring.",
      draftSummary: "Patient concern\n- Cough improving.\n\nFollow-up / instructions\n- Continue monitoring.",
      provider: "LOCAL_PLACEHOLDER",
      simulated: true
    });
    expect(summarized.status).toBe("SUMMARIZED");
    expect(summarized.draftGenerationCount).toBe(1);

    const approved = await approveVisitSummary({ visitId: draft.id });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedSummary).toContain("Cough improving");
    expect(approved.approvedAt).toBeInstanceOf(Date);

    const delivery = await recordEmailDelivery({
      visitId: draft.id,
      recipient: patientEmail,
      status: "SIMULATED",
      providerId: "integration-provider-id"
    });
    expect(delivery.visit.status).toBe("EMAILED");
    expect(delivery.emailDeliveryLog.recipient).toBe(patientEmail);

    const events = await prisma.usageEvent.findMany({
      where: { visitId: draft.id },
      orderBy: { createdAt: "asc" }
    });
    expect(events.map((event) => event.type)).toEqual([
      "VISIT_DRAFT_CREATED",
      "SUMMARY_GENERATED",
      "SUMMARY_APPROVED",
      "SUMMARY_EMAIL_DELIVERY"
    ]);

    const storedVisit = await getVisit(draft.id);
    expect(storedVisit?.status).toBe("EMAILED");
  });

  it("creates a patient summary link and authorizes only the matching patient email", async () => {
    const doctor = await signUpDoctor("Dr. Summary Link", doctorEmail, "pass-123");
    const draft = await createDraftVisit({
      doctorId: doctor.id,
      patient: {
        name: "Patient Placeholder",
        age: 35,
        email: patientEmail
      },
      consentStatus: "GRANTED",
      inputModeRequested: "LIVE_CONVERSATION"
    });
    await saveDraftSummary({
      visitId: draft.id,
      normalizedTranscriptText: "Patient: mild headache improved.",
      draftSummary: "Patient concern\n- Mild headache improved.\n\nFollow-up / instructions\n- Return if symptoms worsen.",
      provider: "LOCAL_PLACEHOLDER",
      simulated: true
    });
    await approveVisitSummary({ visitId: draft.id });

    const link = await createPatientSummaryLinkForVisit({ visitId: draft.id });
    expect(link.url).toBe(`http://localhost:3000/patient/summary/${encodeURIComponent(link.token)}`);
    expect(link.expiresAt).toBeInstanceOf(Date);

    const unauthenticated = await getPatientSummaryLinkAccess({ token: link.token });
    expect(unauthenticated).toMatchObject({
      status: "verification_required",
      sessionEmail: null
    });

    const wrongPatient = await getPatientSummaryLinkAccess({
      token: link.token,
      patientSessionEmail: `other.${id}@doctorai.test`
    });
    expect(wrongPatient).toMatchObject({
      status: "verification_required",
      sessionEmail: `other.${id}@doctorai.test`
    });

    const authorized = await getPatientSummaryLinkAccess({
      token: link.token,
      patientSessionEmail: patientEmail.toUpperCase()
    });
    expect(authorized.status).toBe("authorized");
    if (authorized.status === "authorized") {
      expect(authorized.visit.id).toBe(draft.id);
      expect(authorized.visit.doctor.email).toBe(doctorEmail);
      expect(authorized.visit.approvedSummary).toContain("Mild headache improved");
      expect(authorized.usedAt).toBeInstanceOf(Date);
    }
  });
});
