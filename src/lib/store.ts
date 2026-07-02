import { createHash } from "crypto";
import { generatePatientProgressSummary } from "./azure-openai";
import {
  generateOtpCode,
  generatePatientSessionToken,
  generatePatientSummaryLinkToken,
  hashOtpCode,
  hashPatientSessionToken,
  hashPatientSummaryLinkToken,
  normalizeOtpEmail,
  OTP_EMAIL_COOLDOWN_SECONDS,
  OTP_EXPIRES_IN_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_EMAIL_REQUESTS_PER_WINDOW,
  OTP_MAX_IP_REQUESTS_PER_WINDOW,
  OTP_RATE_LIMIT_WINDOW_MINUTES,
  PATIENT_SESSION_EXPIRES_IN_DAYS,
  PATIENT_SUMMARY_LINK_EXPIRES_IN_DAYS,
  purposeForRoleContext,
  verifyHash,
  type OtpPurpose,
  type OtpRoleContext
} from "./otp";
import { prisma } from "./prisma";
import { getAppBaseUrl, getDemoLoginEnabled } from "./server-config";
import { actualModeForConsent, type ConsentStatus, type InputMode } from "./status";
import type {
  PatientHistoryResponse,
  PatientProgressConfidence,
  PatientProgressSummary,
  PatientProgressTrend,
  PatientSummaryLinkAccess,
  PatientPortalProgressGroup,
  PatientPortalVisit,
  PatientSession,
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

export async function getDoctorByEmail(email: string) {
  return prisma.doctorAccount.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true }
  });
}

export async function getDoctorById(doctorId: string) {
  return prisma.doctorAccount.findUnique({
    where: { id: doctorId },
    select: { id: true, name: true, email: true }
  });
}

function publicPatientSession(session: {
  id: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
}): PatientSession {
  return {
    email: session.email,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt
  };
}

function patientSessionExpiresAt() {
  return new Date(Date.now() + PATIENT_SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
}

function patientSummaryLinkExpiresAt() {
  return new Date(Date.now() + PATIENT_SUMMARY_LINK_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
}

function maskPatientEmail(email: string) {
  const normalized = normalizeOtpEmail(email);
  const [localPart, domainPart = ""] = normalized.split("@");
  const maskedLocal =
    localPart.length <= 2
      ? `${localPart.slice(0, 1) || "*"}***`
      : `${localPart.slice(0, 1)}***${localPart.slice(-1)}`;
  const [domainName = "", ...domainSuffixParts] = domainPart.split(".");
  const maskedDomain =
    domainName.length <= 2
      ? `${domainName.slice(0, 1) || "*"}***`
      : `${domainName.slice(0, 1)}***${domainName.slice(-1)}`;
  const suffix = domainSuffixParts.length ? `.${domainSuffixParts.join(".")}` : "";
  return `${maskedLocal}@${maskedDomain}${suffix}`;
}

function patientSummaryUrl(token: string) {
  return new URL(`/patient/summary/${encodeURIComponent(token)}`, getAppBaseUrl()).toString();
}

export async function createLoginOtpChallenge(input: {
  email: string;
  roleContext: OtpRoleContext;
  purpose?: OtpPurpose;
  requestIp?: string | null;
  userAgent?: string | null;
}) {
  const normalizedEmail = normalizeOtpEmail(input.email);
  const purpose = input.purpose ?? purposeForRoleContext(input.roleContext);
  const now = new Date();
  const cooldownSince = new Date(now.getTime() - OTP_EMAIL_COOLDOWN_SECONDS * 1000);
  const rateLimitSince = new Date(now.getTime() - OTP_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);
  const requestIp = input.requestIp?.trim() || null;

  const [recentEmailOtp, emailRequestCount, ipRequestCount] = await Promise.all([
    prisma.loginOtp.findFirst({
      where: {
        email: normalizedEmail,
        roleContext: input.roleContext,
        purpose,
        createdAt: { gte: cooldownSince }
      },
      select: { id: true }
    }),
    prisma.loginOtp.count({
      where: {
        email: normalizedEmail,
        roleContext: input.roleContext,
        purpose,
        createdAt: { gte: rateLimitSince }
      }
    }),
    requestIp
      ? prisma.loginOtp.count({
          where: {
            requestIp,
            createdAt: { gte: rateLimitSince }
          }
        })
      : Promise.resolve(0)
  ]);

  const rateLimited =
    Boolean(recentEmailOtp) ||
    emailRequestCount >= OTP_MAX_EMAIL_REQUESTS_PER_WINDOW ||
    ipRequestCount >= OTP_MAX_IP_REQUESTS_PER_WINDOW;

  if (rateLimited) {
    return { code: null, expiresAt: null, rateLimited: true };
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_IN_MINUTES * 60 * 1000);

  await prisma.loginOtp.create({
    data: {
      email: normalizedEmail,
      roleContext: input.roleContext,
      purpose,
      codeHash: hashOtpCode({
        email: normalizedEmail,
        roleContext: input.roleContext,
        purpose,
        code
      }),
      expiresAt,
      maxAttempts: OTP_MAX_ATTEMPTS,
      requestIp,
      userAgent: input.userAgent?.slice(0, 500) || null
    }
  });

  return { code, expiresAt, rateLimited: false };
}

export async function createDoctorLoginOtpChallenge(input: {
  email: string;
  requestIp?: string | null;
  userAgent?: string | null;
}) {
  const normalizedEmail = normalizeOtpEmail(input.email);
  const doctor = await getDoctorByEmail(normalizedEmail);
  if (!doctor) {
    return { code: null, expiresAt: null, rateLimited: false, accountExists: false as const, doctor: null };
  }

  const challenge = await createLoginOtpChallenge({
    email: normalizedEmail,
    roleContext: "doctor",
    purpose: purposeForRoleContext("doctor"),
    requestIp: input.requestIp,
    userAgent: input.userAgent
  });

  return {
    ...challenge,
    accountExists: true as const,
    doctor
  };
}

export async function createDoctorPasswordResetOtpChallenge(input: {
  email: string;
  requestIp?: string | null;
  userAgent?: string | null;
}) {
  const normalizedEmail = normalizeOtpEmail(input.email);
  const doctor = await getDoctorByEmail(normalizedEmail);
  if (!doctor) {
    return { code: null, expiresAt: null, rateLimited: false, accountExists: false as const, doctor: null };
  }

  const challenge = await createLoginOtpChallenge({
    email: normalizedEmail,
    roleContext: "doctor",
    purpose: "password_reset",
    requestIp: input.requestIp,
    userAgent: input.userAgent
  });

  return {
    ...challenge,
    accountExists: true as const,
    doctor
  };
}

export async function verifyLoginOtp(input: {
  email: string;
  roleContext: OtpRoleContext;
  purpose?: OtpPurpose;
  code: string;
}) {
  const normalizedEmail = normalizeOtpEmail(input.email);
  const purpose = input.purpose ?? purposeForRoleContext(input.roleContext);
  const now = new Date();
  const loginOtp = await prisma.loginOtp.findFirst({
    where: {
      email: normalizedEmail,
      roleContext: input.roleContext,
      purpose,
      consumedAt: null
    },
    orderBy: { createdAt: "desc" }
  });

  if (!loginOtp || loginOtp.expiresAt <= now || loginOtp.attemptCount >= loginOtp.maxAttempts) {
    return { verified: false as const, patientSession: null, patientSessionToken: null };
  }

  const candidateHash = hashOtpCode({
    email: normalizedEmail,
    roleContext: input.roleContext,
    purpose,
    code: input.code
  });

  if (!verifyHash(candidateHash, loginOtp.codeHash)) {
    await prisma.loginOtp.update({
      where: { id: loginOtp.id },
      data: { attemptCount: { increment: 1 } }
    });
    return { verified: false as const, patientSession: null, patientSessionToken: null };
  }

  return prisma.$transaction(async (tx) => {
    await tx.loginOtp.update({
      where: { id: loginOtp.id },
      data: {
        consumedAt: now,
        attemptCount: { increment: 1 }
      }
    });

    if (input.roleContext !== "patient") {
      return { verified: true as const, patientSession: null, patientSessionToken: null };
    }

    const patientSessionToken = generatePatientSessionToken();
    const patientSession = await tx.patientSession.create({
      data: {
        email: normalizedEmail,
        sessionTokenHash: hashPatientSessionToken(patientSessionToken),
        expiresAt: patientSessionExpiresAt()
      }
    });

    return {
      verified: true as const,
      patientSession: publicPatientSession(patientSession),
      patientSessionToken
    };
  });
}

export async function verifyDoctorLoginOtp(input: { email: string; code: string }) {
  const normalizedEmail = normalizeOtpEmail(input.email);
  const doctor = await getDoctorByEmail(normalizedEmail);
  if (!doctor) return null;

  const result = await verifyLoginOtp({
    email: normalizedEmail,
    roleContext: "doctor",
    purpose: purposeForRoleContext("doctor"),
    code: input.code
  });

  if (!result.verified) return null;
  return doctor;
}

export async function resetDoctorPasswordWithOtp(input: { email: string; code: string; password: string }) {
  const normalizedEmail = normalizeOtpEmail(input.email);
  const doctor = await getDoctorByEmail(normalizedEmail);
  if (!doctor) return null;

  const result = await verifyLoginOtp({
    email: normalizedEmail,
    roleContext: "doctor",
    purpose: "password_reset",
    code: input.code
  });

  if (!result.verified) return null;

  return prisma.doctorAccount.update({
    where: { id: doctor.id },
    data: { passwordHash: hashPassword(input.password) },
    select: { id: true, name: true, email: true }
  });
}

export async function getPatientSessionByToken(token: string | undefined | null) {
  if (!token) return null;

  const now = new Date();
  const session = await prisma.patientSession.findUnique({
    where: { sessionTokenHash: hashPatientSessionToken(token) }
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    return null;
  }

  const updatedSession = await prisma.patientSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now }
  });

  return publicPatientSession(updatedSession);
}

export async function revokePatientSessionByToken(token: string | undefined | null) {
  if (!token) return;

  await prisma.patientSession
    .update({
      where: { sessionTokenHash: hashPatientSessionToken(token) },
      data: { revokedAt: new Date() }
    })
    .catch(() => undefined);
}

export async function createPatientSummaryLinkForVisit(input: { visitId: string }) {
  const visit = await prisma.visit.findUnique({
    where: { id: input.visitId },
    include: { patient: true }
  });

  if (!visit) {
    throw new Error("Visit not found.");
  }

  if (!visit.approvedSummary?.trim()) {
    throw new Error("Approve the summary before creating a patient link.");
  }

  const token = generatePatientSummaryLinkToken();
  const expiresAt = patientSummaryLinkExpiresAt();
  const link = await prisma.patientSummaryLink.create({
    data: {
      visitId: visit.id,
      patientEmail: normalizeOtpEmail(visit.patient.email),
      tokenHash: hashPatientSummaryLinkToken(token),
      expiresAt,
      createdByDoctorId: visit.doctorId
    }
  });

  return {
    token,
    url: patientSummaryUrl(token),
    expiresAt: link.expiresAt
  };
}

export async function getPatientSummaryLinkOtpTarget(token: string) {
  const trimmedToken = token.trim();
  if (!trimmedToken) return { status: "invalid" as const };

  const link = await prisma.patientSummaryLink.findUnique({
    where: { tokenHash: hashPatientSummaryLinkToken(trimmedToken) },
    include: {
      visit: {
        select: {
          approvedSummary: true
        }
      }
    }
  });

  if (!link || !link.visit.approvedSummary?.trim()) {
    return { status: "invalid" as const };
  }

  if (link.expiresAt <= new Date()) {
    return {
      status: "expired" as const,
      maskedPatientEmail: maskPatientEmail(link.patientEmail),
      expiresAt: link.expiresAt
    };
  }

  return {
    status: "ready" as const,
    patientEmail: normalizeOtpEmail(link.patientEmail),
    maskedPatientEmail: maskPatientEmail(link.patientEmail),
    expiresAt: link.expiresAt
  };
}

export async function getPatientSummaryLinkAccess(input: {
  token: string;
  patientSessionEmail?: string | null;
}): Promise<PatientSummaryLinkAccess> {
  const token = input.token.trim();
  if (!token) return { status: "invalid" };

  const link = await prisma.patientSummaryLink.findUnique({
    where: { tokenHash: hashPatientSummaryLinkToken(token) },
    include: {
      visit: {
        include: {
          patient: true,
          doctor: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }
    }
  });

  if (!link || !link.visit.approvedSummary?.trim()) {
    return { status: "invalid" };
  }

  const now = new Date();
  const maskedPatientEmail = maskPatientEmail(link.patientEmail);
  if (link.expiresAt <= now) {
    return {
      status: "expired",
      maskedPatientEmail,
      expiresAt: link.expiresAt
    };
  }

  const patientSessionEmail = input.patientSessionEmail ? normalizeOtpEmail(input.patientSessionEmail) : null;
  if (patientSessionEmail !== normalizeOtpEmail(link.patientEmail)) {
    return {
      status: "verification_required",
      maskedPatientEmail,
      expiresAt: link.expiresAt,
      sessionEmail: patientSessionEmail
    };
  }

  const usedAt = link.usedAt
    ? link.usedAt
    : (
        await prisma.patientSummaryLink
          .update({
            where: { id: link.id },
            data: { usedAt: now },
            select: { usedAt: true }
          })
          .catch(() => ({ usedAt: link.usedAt }))
      ).usedAt;

  return {
    status: "authorized",
    expiresAt: link.expiresAt,
    usedAt,
    visit: {
      id: link.visit.id,
      doctor: link.visit.doctor,
      patientName: link.visit.patient.name,
      patientAge: link.visit.patient.age,
      approvedSummary: link.visit.approvedSummary || "",
      approvedAt: link.visit.approvedAt,
      createdAt: link.visit.createdAt
    }
  };
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

export async function listPatientPortalApprovedVisits(email: string): Promise<PatientPortalVisit[]> {
  const normalizedPatientEmail = normalizeOtpEmail(email);
  const visits = await prisma.visit.findMany({
    where: {
      approvedSummary: { not: null },
      patient: {
        is: { email: normalizedPatientEmail }
      }
    },
    select: {
      id: true,
      approvedSummary: true,
      approvedAt: true,
      createdAt: true,
      patient: {
        select: {
          name: true,
          age: true
        }
      },
      doctor: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }]
  });

  return visits
    .filter((visit) => Boolean(visit.approvedSummary?.trim()))
    .map((visit) => ({
      id: visit.id,
      doctor: visit.doctor,
      patientName: visit.patient.name,
      patientAge: visit.patient.age,
      approvedSummary: visit.approvedSummary || "",
      approvedAt: visit.approvedAt,
      createdAt: visit.createdAt
    }));
}

export async function listPatientPortalProgress(email: string): Promise<PatientPortalProgressGroup[]> {
  const normalizedPatientEmail = normalizeOtpEmail(email);
  const approvedVisits = await prisma.visit.findMany({
    where: {
      approvedSummary: { not: null },
      patient: {
        is: { email: normalizedPatientEmail }
      }
    },
    include: {
      patient: true,
      doctor: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: [{ doctorId: "asc" }, { approvedAt: "desc" }, { createdAt: "desc" }]
  });

  const visitsByDoctor = new Map<string, typeof approvedVisits>();
  for (const visit of approvedVisits.filter((visit) => Boolean(visit.approvedSummary?.trim()))) {
    const existing = visitsByDoctor.get(visit.doctorId) || [];
    existing.push(visit);
    visitsByDoctor.set(visit.doctorId, existing);
  }

  const progressGroups: PatientPortalProgressGroup[] = [];
  for (const [doctorId, doctorVisits] of visitsByDoctor.entries()) {
    if (doctorVisits.length < 2) continue;

    const progressSummary = await generateOrUpdatePatientProgressSummaryForDoctor({
      doctorId,
      patientEmail: normalizedPatientEmail
    });

    if (!progressSummary) continue;

    progressGroups.push({
      doctor: doctorVisits[0].doctor,
      approvedVisitCount: progressSummary.approvedVisitCount,
      trend: progressSummary.trend,
      confidence: progressSummary.confidence,
      generatedAt: progressSummary.generatedAt,
      keyChangesSinceLastVisit: progressSummary.keyChangesSinceLastVisit,
      unresolvedIssues: progressSummary.unresolvedIssues,
      followUpProgress: progressSummary.followUpProgress
    });
  }

  return progressGroups;
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
    const existingVisit = await tx.visit.findUnique({
      where: { id: input.visitId },
      select: { status: true, doctorId: true }
    });

    if (!existingVisit) {
      throw new Error("Visit not found.");
    }

    const emailDeliveryLog = await tx.emailDeliveryLog.create({
      data: {
        visitId: input.visitId,
        doctorId: existingVisit.doctorId,
        recipient: input.recipient,
        status: input.status,
        providerId: input.providerId ?? null,
        error: input.error ?? null
      }
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

export async function recordDoctorEmailDelivery(input: {
  doctorId: string;
  recipient: string;
  status: string;
  providerId?: string;
  error?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const doctor = await tx.doctorAccount.findUnique({
      where: { id: input.doctorId },
      select: { id: true, name: true, email: true }
    });

    if (!doctor) {
      throw new Error("Doctor not found.");
    }

    const emailDeliveryLog = await tx.emailDeliveryLog.create({
      data: {
        doctorId: doctor.id,
        visitId: null,
        recipient: input.recipient,
        status: input.status,
        providerId: input.providerId ?? null,
        error: input.error ?? null
      }
    });

    await tx.usageEvent.create({
      data: {
        doctorId: doctor.id,
        visitId: null,
        type: "DOCTOR_TEST_EMAIL_DELIVERY",
        metadata: JSON.stringify({
          status: input.status,
          providerId: input.providerId,
          error: input.error
        })
      }
    });

    return { doctor, emailDeliveryLog };
  });
}

export async function recordAuthEmailDelivery(input: {
  doctorId?: string | null;
  recipient: string;
  status: string;
  providerId?: string;
  error?: string;
  eventType?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const emailDeliveryLog = await tx.emailDeliveryLog.create({
      data: {
        doctorId: input.doctorId ?? null,
        visitId: null,
        recipient: input.recipient,
        status: input.status,
        providerId: input.providerId ?? null,
        error: input.error ?? null
      }
    });

    if (input.doctorId) {
      await tx.usageEvent.create({
        data: {
          doctorId: input.doctorId,
          visitId: null,
          type: input.eventType ?? "AUTH_EMAIL_DELIVERY",
          metadata: JSON.stringify({
            status: input.status,
            providerId: input.providerId,
            error: input.error
          })
        }
      });
    }

    return emailDeliveryLog;
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
