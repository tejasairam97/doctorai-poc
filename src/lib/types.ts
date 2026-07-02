export type Patient = {
  id: string;
  name: string;
  age: number;
  email: string;
  phone?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type Visit = {
  id: string;
  doctorId: string;
  patientId: string;
  consentStatus: string;
  inputModeRequested: string;
  inputModeActual: string;
  status: string;
  transcriptText: string;
  normalizedTranscriptText?: string | null;
  draftSummary?: string | null;
  approvedSummary?: string | null;
  unencryptedEmailConsent: boolean;
  unencryptedEmailConsentStatus: string;
  resumeCount: number;
  interruptionReason?: string | null;
  transcriptLastSavedAt?: string | Date | null;
  approvedAt?: string | Date | null;
  emailedAt?: string | Date | null;
  draftGenerationCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type VisitWithPatient = Visit & {
  patient: Patient;
};

export type PatientHistoryVisit = VisitWithPatient & {
  isCurrentVisit?: boolean;
};

export type PatientProgressTrend = "improving" | "stable" | "worsening" | "mixed" | "unclear";

export type PatientProgressConfidence = "early signal" | "moderate" | "limited evidence" | "unclear";

export type PatientProgressSummary = {
  id?: string;
  patientId?: string;
  patientEmail?: string;
  trend: PatientProgressTrend;
  confidence: PatientProgressConfidence;
  cacheVersion?: string;
  approvedVisitCount: number;
  summaryContent: string;
  latestApprovedAt?: string | Date | null;
  previousApprovedAt?: string | Date | null;
  generatedAt?: string | Date | null;
  updatedAt?: string | Date | null;
  timelineSnapshot: string[];
  keyChangesSinceLastVisit: string[];
  unresolvedIssues: string[];
  followUpProgress: string[];
  doctorReviewPrompts: string[];
};

export type PatientHistoryResponse = {
  patientEmail: string;
  totalVisitCount: number;
  priorVisitCount: number;
  approvedVisitCount: number;
  visits: PatientHistoryVisit[];
  progressSummary?: PatientProgressSummary | null;
};

export type UsageEvent = {
  id: string;
  doctorId: string;
  visitId?: string | null;
  type: string;
  metadata?: string | null;
  createdAt: string | Date;
  doctor?: {
    id: string;
    name: string;
    email: string;
  };
  visit?: VisitWithPatient | null;
};

export type EmailDeliveryLog = {
  id: string;
  visitId?: string | null;
  doctorId?: string | null;
  recipient: string;
  status: string;
  providerId?: string | null;
  error?: string | null;
  createdAt: string | Date;
};

export type PatientSession = {
  id?: string;
  email: string;
  expiresAt: string | Date;
  createdAt: string | Date;
};

export type PatientPortalVisit = {
  id: string;
  doctor: {
    id: string;
    name: string;
    email: string;
  };
  patientName: string;
  patientAge: number;
  approvedSummary: string;
  approvedAt?: string | Date | null;
  createdAt: string | Date;
};

export type PatientSummaryLinkAccess =
  | {
      status: "invalid";
    }
  | {
      status: "expired";
      maskedPatientEmail: string;
      expiresAt: string | Date;
    }
  | {
      status: "verification_required";
      maskedPatientEmail: string;
      expiresAt: string | Date;
      sessionEmail?: string | null;
    }
  | {
      status: "authorized";
      expiresAt: string | Date;
      usedAt?: string | Date | null;
      visit: PatientPortalVisit;
    };

export type PatientPortalProgressGroup = {
  doctor: {
    id: string;
    name: string;
    email: string;
  };
  approvedVisitCount: number;
  trend: PatientProgressTrend;
  confidence: PatientProgressConfidence;
  generatedAt?: string | Date | null;
  keyChangesSinceLastVisit: string[];
  unresolvedIssues: string[];
  followUpProgress: string[];
};
