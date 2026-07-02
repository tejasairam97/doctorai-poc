import { createHash } from "crypto";
import { generatePatientProgressSummary } from "./azure-openai";
import { prisma } from "./prisma";
import { getDemoLoginEnabled } from "./server-config";
import { actualModeForConsent, type ConsentStatus, type InputMode } from "./status";
import type {
  PatientHistoryResponse,
  PatientProgressConfidence,
  PatientProgressSummary,
  PatientProgressTrend,
  VisitWithPatient
} from "./types";

const PATIENT_PROGRESS_CACHE_VERSION = "progress-summary-v2";

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

const PROGRESS_CACHE_SECTION_HEADINGS = [
  "Timeline snapshot",
  "Key changes since last visit",
  "Persistent or unresolved issues",
  "Unresolved issues",
  "Follow-up progress / adherence",
  "Follow-up progress",
  "Doctor review prompts"
];

function cleanSummaryLine(line: string) {
  return line.replace(/^[-*]\s*/, "").trim();
}

function isProgressTrend(value: string): value is PatientProgressTrend {
  return (
    value === "improving" ||
    value === "stable" ||
    value === "worsening" ||
    value === "mixed" ||
    value === "unclear"
  );
}

function isProgressConfidence(value: string): value is PatientProgressConfidence {
  return value === "early signal" || value === "moderate" || value === "limited evidence" || value === "unclear";
}

function extractProgressCacheSection(summaryContent: string, heading: string) {
  const lines = summaryContent.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (startIndex < 0) return [];

  const sectionLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    const cleaned = cleanSummaryLine(line);
    if (!cleaned) continue;
    if (PROGRESS_CACHE_SECTION_HEADINGS.some((knownHeading) => cleaned.toLowerCase() === knownHeading.toLowerCase())) {
      break;
    }
    sectionLines.push(cleaned);
  }

  return sectionLines;
}

function progressSummaryFromCache(cache: {
  id: string;
  patientId: string;
  patientEmail: string;
  approvedVisitCount: number;
  summaryContent: string;
  trendLabel: string;
  confidenceLabel: string;
  cacheVersion: string;
  generatedAt: Date;
  updatedAt: Date;
}): PatientProgressSummary {
  return {
    id: cache.id,
    patientId: cache.patientId,
    patientEmail: cache.patientEmail,
    trend: isProgressTrend(cache.trendLabel) ? cache.trendLabel : "unclear",
    confidence: isProgressConfidence(cache.confidenceLabel) ? cache.confidenceLabel : "unclear",
    cacheVersion: cache.cacheVersion,
    approvedVisitCount: cache.approvedVisitCount,
    summaryContent: cache.summaryContent,
    generatedAt: cache.generatedAt,
    updatedAt: cache.updatedAt,
    timelineSnapshot: extractProgressCacheSection(cache.summaryContent, "Timeline snapshot"),
    keyChangesSinceLastVisit: extractProgressCacheSection(cache.summaryContent, "Key changes since last visit"),
    unresolvedIssues:
      extractProgressCacheSection(cache.summaryContent, "Persistent or unresolved issues").length > 0
        ? extractProgressCacheSection(cache.summaryContent, "Persistent or unresolved issues")
        : extractProgressCacheSection(cache.summaryContent, "Unresolved issues"),
    followUpProgress:
      extractProgressCacheSection(cache.summaryContent, "Follow-up progress / adherence").length > 0
        ? extractProgressCacheSection(cache.summaryContent, "Follow-up progress / adherence")
        : extractProgressCacheSection(cache.summaryContent, "Follow-up progress"),
    doctorReviewPrompts: extractProgressCacheSection(cache.summaryContent, "Doctor review prompts")
  };
}

function latestApprovedVisitTime(approvedVisits: VisitWithPatient[]) {
  const latestVisit = approvedVisits[0];
  if (!latestVisit) return 0;
  return new Date(latestVisit.approvedAt ?? latestVisit.updatedAt).getTime();
}

function isProgressCacheFresh(progressSummary: PatientProgressSummary | null, approvedVisits: VisitWithPatient[]) {
  if (!progressSummary?.generatedAt) return false;
  if (progressSummary.cacheVersion !== PATIENT_PROGRESS_CACHE_VERSION) return false;
  if (progressSummary.approvedVisitCount !== approvedVisits.length) return false;
  return new Date(progressSummary.generatedAt).getTime() >= latestApprovedVisitTime(approvedVisits);
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

async function listDoctorPatientVisitsByEmail(doctorId: string, patientEmail: string) {
  const normalizedPatientEmail = patientEmail.trim().toLowerCase();
  const patients = await prisma.patient.findMany({
    where: { email: normalizedPatientEmail },
    select: { id: true },
    orderBy: { createdAt: "desc" }
  });

  const patientIds = patients.map((patient) => patient.id);
  if (patientIds.length === 0) return [];

  return prisma.visit.findMany({
    where: {
      doctorId,
      patientId: { in: patientIds }
    },
    include: { patient: true },
    orderBy: { createdAt: "desc" }
  });
}

async function upsertProgressSummaryFromApprovedVisits(input: {
  doctorId: string;
  patientEmail: string;
  approvedVisits: VisitWithPatient[];
}) {
  if (input.approvedVisits.length < 2) return null;

  const normalizedPatientEmail = input.patientEmail.trim().toLowerCase();
  const [latestVisit, previousVisit] = input.approvedVisits;
  const generatedSummary = await generatePatientProgressSummary({
    approvedSummaries: input.approvedVisits.map((visit) => ({
      approvedAt: visit.approvedAt,
      approvedSummary: visit.approvedSummary || ""
    }))
  });
  const progressSummary: PatientProgressSummary = {
    patientId: latestVisit.patientId,
    patientEmail: normalizedPatientEmail,
    trend: generatedSummary.trend,
    confidence: generatedSummary.confidence,
    cacheVersion: PATIENT_PROGRESS_CACHE_VERSION,
    approvedVisitCount: input.approvedVisits.length,
    summaryContent: generatedSummary.summaryContent,
    latestApprovedAt: latestVisit.approvedAt,
    previousApprovedAt: previousVisit.approvedAt,
    timelineSnapshot: generatedSummary.timelineSnapshot,
    keyChangesSinceLastVisit: generatedSummary.keyChangesSinceLastVisit,
    unresolvedIssues: generatedSummary.unresolvedIssues,
    followUpProgress: generatedSummary.followUpProgress,
    doctorReviewPrompts: generatedSummary.doctorReviewPrompts
  };
  const now = new Date();
  try {
    const cache = await prisma.patientProgressSummary.upsert({
      where: {
        doctorId_patientEmail: {
          doctorId: input.doctorId,
          patientEmail: normalizedPatientEmail
        }
      },
      create: {
        doctorId: input.doctorId,
        patientId: latestVisit.patientId,
        patientEmail: normalizedPatientEmail,
        approvedVisitCount: progressSummary.approvedVisitCount,
        summaryContent: progressSummary.summaryContent,
        trendLabel: progressSummary.trend,
        confidenceLabel: progressSummary.confidence,
        cacheVersion: PATIENT_PROGRESS_CACHE_VERSION,
        generatedAt: now
      },
      update: {
        patientId: latestVisit.patientId,
        approvedVisitCount: progressSummary.approvedVisitCount,
        summaryContent: progressSummary.summaryContent,
        trendLabel: progressSummary.trend,
        confidenceLabel: progressSummary.confidence,
        cacheVersion: PATIENT_PROGRESS_CACHE_VERSION,
        generatedAt: now
      }
    });

    return {
      ...progressSummary,
      id: cache.id,
      patientEmail: cache.patientEmail,
      generatedAt: cache.generatedAt,
      updatedAt: cache.updatedAt
    };
  } catch (error) {
    console.warn("[DoctorAI patient progress cache unavailable]", error);
    return {
      ...progressSummary,
      generatedAt: now,
      updatedAt: now
    };
  }
}

export async function getPatientHistoryForDoctor(input: {
  doctorId: string;
  patientEmail: string;
  currentVisitId?: string | null;
}): Promise<PatientHistoryResponse> {
  const normalizedPatientEmail = input.patientEmail.trim().toLowerCase();
  const visits = await listDoctorPatientVisitsByEmail(input.doctorId, normalizedPatientEmail);

  const historyVisits = visits.map((visit) => ({
    ...visit,
    isCurrentVisit: visit.id === input.currentVisitId
  }));

  const approvedVisits = [...historyVisits]
    .filter((visit) => Boolean(visit.approvedSummary?.trim()))
    .sort((left, right) => {
      const leftDate = new Date(left.approvedAt ?? left.updatedAt).getTime();
      const rightDate = new Date(right.approvedAt ?? right.updatedAt).getTime();
      return rightDate - leftDate;
    });
  const cachedProgressSummary =
    approvedVisits.length >= 2
      ? await getPatientProgressSummaryForDoctor({
          doctorId: input.doctorId,
          patientEmail: normalizedPatientEmail
        })
      : null;
  const progressSummary =
    approvedVisits.length < 2
      ? null
      : isProgressCacheFresh(cachedProgressSummary, approvedVisits)
        ? cachedProgressSummary
        : await upsertProgressSummaryFromApprovedVisits({
            doctorId: input.doctorId,
            patientEmail: normalizedPatientEmail,
            approvedVisits
          });

  return {
    patientEmail: normalizedPatientEmail,
    totalVisitCount: historyVisits.length,
    priorVisitCount: input.currentVisitId
      ? historyVisits.filter((visit) => !visit.isCurrentVisit).length
      : historyVisits.length,
    approvedVisitCount: approvedVisits.length,
    visits: historyVisits,
    progressSummary
  };
}

export async function getPatientProgressSummaryForDoctor(input: {
  doctorId: string;
  patientEmail: string;
}) {
  const normalizedPatientEmail = input.patientEmail.trim().toLowerCase();
  try {
    const cache = await prisma.patientProgressSummary.findUnique({
      where: {
        doctorId_patientEmail: {
          doctorId: input.doctorId,
          patientEmail: normalizedPatientEmail
        }
      }
    });

    if (!cache || cache.cacheVersion !== PATIENT_PROGRESS_CACHE_VERSION) return null;
    return progressSummaryFromCache(cache);
  } catch (error) {
    console.warn("[DoctorAI patient progress cache fetch failed]", error);
    return null;
  }
}

export async function generateOrUpdatePatientProgressSummaryForDoctor(input: {
  doctorId: string;
  patientEmail: string;
}) {
  const normalizedPatientEmail = input.patientEmail.trim().toLowerCase();
  const visits = await listDoctorPatientVisitsByEmail(input.doctorId, normalizedPatientEmail);
  const approvedVisits = visits
    .filter((visit) => Boolean(visit.approvedSummary?.trim()))
    .sort((left, right) => {
      const leftDate = new Date(left.approvedAt ?? left.updatedAt).getTime();
      const rightDate = new Date(right.approvedAt ?? right.updatedAt).getTime();
      return rightDate - leftDate;
    });

  return upsertProgressSummaryFromApprovedVisits({
    doctorId: input.doctorId,
    patientEmail: normalizedPatientEmail,
    approvedVisits
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
