import { createHash } from "crypto";
import { prisma } from "./prisma";
import { getDemoLoginEnabled } from "./server-config";
import { actualModeForConsent, type ConsentStatus, type InputMode } from "./status";

export function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export function publicDoctor(doctor: { id: string; name: string; email: string }) {
  return {
    id: doctor.id,
    name: doctor.name,
    email: doctor.email
  };
}

export async function signUpDoctor(name: string, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.doctorAccount.findUnique({
    where: { email: normalizedEmail }
  });

  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  return prisma.doctorAccount.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password)
    }
  });
}

export async function ensureDemoDoctor() {
  if (!getDemoLoginEnabled()) {
    throw new Error("Demo login is disabled for this environment.");
  }

  const email = "demo@doctorai.local";
  return prisma.doctorAccount.upsert({
    where: { email },
    update: {},
    create: {
      name: "Dr. Demo",
      email,
      passwordHash: hashPassword("password123")
    }
  });
}

export async function loginDoctor(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === "demo@doctorai.local") {
    if (!getDemoLoginEnabled()) return null;
    await ensureDemoDoctor();
  }

  return prisma.doctorAccount.findFirst({
    where: {
      email: normalizedEmail,
      passwordHash: hashPassword(password)
    }
  });
}

export async function getDoctorById(doctorId: string) {
  return prisma.doctorAccount.findUnique({
    where: { id: doctorId },
    select: { id: true, name: true, email: true }
  });
}

export async function createDraftVisit(input: {
  doctorId: string;
  patient: { name: string; age: number; email: string; phone?: string };
  consentStatus: ConsentStatus;
  inputModeRequested: InputMode;
}) {
  const inputModeActual = actualModeForConsent(input.consentStatus, input.inputModeRequested);
  const normalizedPatientEmail = input.patient.email.trim().toLowerCase();
  const patientName = input.patient.name.trim();

  return prisma.$transaction(async (tx) => {
    const recentDraftCutoff = new Date(Date.now() - 60 * 1000);
    const recentDraft = await tx.visit.findFirst({
      where: {
        doctorId: input.doctorId,
        status: "DRAFT",
        transcriptText: "",
        createdAt: { gte: recentDraftCutoff },
        patient: {
          is: {
            email: normalizedPatientEmail,
            name: patientName
          }
        }
      },
      include: { patient: true },
      orderBy: { createdAt: "desc" }
    });

    if (recentDraft) return recentDraft;

    const patient = await tx.patient.create({
      data: {
        name: patientName,
        age: input.patient.age,
        email: normalizedPatientEmail,
        phone: input.patient.phone?.trim() || null
      }
    });

    const visit = await tx.visit.create({
      data: {
        doctorId: input.doctorId,
        patientId: patient.id,
        consentStatus: input.consentStatus,
        inputModeRequested: input.inputModeRequested,
        inputModeActual,
        status: "DRAFT"
      },
      include: { patient: true }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: input.doctorId,
        visitId: visit.id,
        type: "VISIT_DRAFT_CREATED",
        metadata: JSON.stringify({
          consentStatus: input.consentStatus,
          inputModeRequested: input.inputModeRequested,
          inputModeActual
        })
      }
    });

    return visit;
  });
}

export async function listVisits(doctorId: string) {
  return prisma.visit.findMany({
    where: { doctorId },
    include: { patient: true },
    orderBy: { createdAt: "desc" }
  });
}

export async function getVisit(visitId: string) {
  return prisma.visit.findUnique({
    where: { id: visitId },
    include: { patient: true }
  });
}

export async function saveVisitTranscript(input: {
  visitId: string;
  transcriptText: string;
  inputModeActual: InputMode;
  status?: string;
}) {
  const existing = await prisma.visit.findUnique({
    where: { id: input.visitId },
    select: { approvedSummary: true }
  });

  if (existing?.approvedSummary) {
    throw new Error("Approved visits cannot be edited.");
  }

  return prisma.visit.update({
    where: { id: input.visitId },
    data: {
      transcriptText: input.transcriptText,
      inputModeActual: input.inputModeActual,
      status:
        input.status ??
        (input.inputModeActual === "DOCTOR_SELF_SUMMARY" ? "READY_FOR_DOCUMENTATION" : "RECORDING"),
      transcriptLastSavedAt: new Date()
    },
    include: { patient: true }
  });
}

export async function markVisitInterrupted(input: {
  visitId: string;
  reason: string;
  transcriptText: string;
  inputModeActual: InputMode;
}) {
  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.update({
      where: { id: input.visitId },
      data: {
        transcriptText: input.transcriptText,
        inputModeActual: input.inputModeActual,
        status: "INTERRUPTED",
        interruptionReason: input.reason,
        transcriptLastSavedAt: new Date()
      },
      include: { patient: true }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: visit.doctorId,
        visitId: visit.id,
        type: "VISIT_INTERRUPTED",
        metadata: JSON.stringify({ reason: input.reason, inputModeActual: input.inputModeActual })
      }
    });

    return visit;
  });
}

export async function resumeVisit(visitId: string, inputModeActual: InputMode) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.visit.findUnique({
      where: { id: visitId }
    });

    if (!existing) {
      throw new Error("Visit not found.");
    }

    const visit = await tx.visit.update({
      where: { id: visitId },
      data: {
        inputModeActual,
        status: inputModeActual === "DOCTOR_SELF_SUMMARY" ? "READY_FOR_DOCUMENTATION" : "RECORDING",
        interruptionReason: null,
        resumeCount: { increment: 1 }
      },
      include: { patient: true }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: visit.doctorId,
        visitId: visit.id,
        type: "VISIT_RESUMED",
        metadata: JSON.stringify({ resumeCount: visit.resumeCount, inputModeActual })
      }
    });

    return visit;
  });
}

export async function logTranscriptionAttempt(input: {
  doctorId: string;
  visitId: string;
  inputModeActual: InputMode;
  status: "TOKEN_ISSUED" | "CONFIG_MISSING" | "TOKEN_FAILED" | "CLIENT_STARTED" | "CLIENT_FAILED";
  reason?: string;
}) {
  return prisma.usageEvent.create({
    data: {
      doctorId: input.doctorId,
      visitId: input.visitId,
      type: "TRANSCRIPTION_ATTEMPT",
      metadata: JSON.stringify({
        inputModeActual: input.inputModeActual,
        status: input.status,
        reason: input.reason,
        provider: "AZURE_SPEECH"
      })
    }
  });
}

export async function logUsageEvent(input: {
  doctorId: string;
  visitId?: string | null;
  type: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.usageEvent.create({
    data: {
      doctorId: input.doctorId,
      visitId: input.visitId ?? null,
      type: input.type,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null
    }
  });
}

export async function saveDraftSummary(input: {
  visitId: string;
  normalizedTranscriptText: string;
  draftSummary: string;
  provider: string;
  simulated: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.update({
      where: { id: input.visitId },
      data: {
        normalizedTranscriptText: input.normalizedTranscriptText,
        draftSummary: input.draftSummary,
        status: "SUMMARIZED",
        draftGenerationCount: { increment: 1 }
      },
      include: { patient: true }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: visit.doctorId,
        visitId: visit.id,
        type: "SUMMARY_GENERATED",
        metadata: JSON.stringify({
          provider: input.provider,
          simulated: input.simulated,
          draftGenerationCount: visit.draftGenerationCount,
          inputModeActual: visit.inputModeActual,
          normalizedTranscriptSaved: true
        })
      }
    });

    return visit;
  });
}

export async function approveVisitSummary(input: {
  visitId: string;
  approvedSummary?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.visit.findUnique({
      where: { id: input.visitId },
      include: { patient: true }
    });

    if (!existing) {
      throw new Error("Visit not found.");
    }

    const approvedSummary = (existing.approvedSummary || input.approvedSummary || existing.draftSummary || "").trim();
    if (!approvedSummary) {
      throw new Error("A draft or edited summary is required before approval.");
    }

    const visit = await tx.visit.update({
      where: { id: input.visitId },
      data: {
        approvedSummary,
        approvedAt: existing.approvedAt ?? new Date(),
        status: "APPROVED"
      },
      include: { patient: true }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: visit.doctorId,
        visitId: visit.id,
        type: "SUMMARY_APPROVED",
        metadata: JSON.stringify({
          inputModeActual: visit.inputModeActual,
          draftGenerationCount: visit.draftGenerationCount,
          existingApproval: Boolean(existing.approvedSummary)
        })
      }
    });

    return visit;
  });
}

export async function updateUnencryptedEmailConsent(input: {
  visitId: string;
  consentStatus: "APPROVED" | "DECLINED" | "NOT_ASKED";
}) {
  return prisma.visit.update({
    where: { id: input.visitId },
    data: {
      unencryptedEmailConsent: input.consentStatus === "APPROVED",
      unencryptedEmailConsentStatus: input.consentStatus
    },
    include: { patient: true }
  });
}

export async function recordEmailDelivery(input: {
  visitId: string;
  recipient: string;
  status: string;
  providerId?: string;
  error?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const emailDeliveryLog = await tx.emailDeliveryLog.create({
      data: {
        visitId: input.visitId,
        recipient: input.recipient,
        status: input.status,
        providerId: input.providerId ?? null,
        error: input.error ?? null
      }
    });

    const existingVisit = await tx.visit.findUnique({
      where: { id: input.visitId },
      select: { status: true }
    });
    const emailSucceeded = input.status === "SENT" || input.status === "SIMULATED";
    const emailBlocked = input.status === "BLOCKED";
    const visit = await tx.visit.update({
      where: { id: input.visitId },
      data: {
        status: emailSucceeded ? "EMAILED" : emailBlocked ? (existingVisit?.status ?? "APPROVED") : "EMAIL_FAILED",
        emailedAt: emailSucceeded ? new Date() : undefined
      },
      include: { patient: true }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: visit.doctorId,
        visitId: visit.id,
        type: "SUMMARY_EMAIL_DELIVERY",
        metadata: JSON.stringify({
          status: input.status,
          providerId: input.providerId,
          error: input.error
        })
      }
    });

    return { visit, emailDeliveryLog };
  });
}

export async function listInternalUsageEvents(limit = 25) {
  return prisma.usageEvent.findMany({
    take: Math.min(Math.max(limit, 1), 100),
    orderBy: { createdAt: "desc" },
    include: {
      doctor: { select: { id: true, name: true, email: true } },
      visit: { include: { patient: true } }
    }
  });
}
