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

export type PatientProgressTrend = "improving" | "stable" | "worsening" | "unclear";

export type PatientProgressSummary = {
  id?: string;
  patientId?: string;
  patientEmail?: string;
  trend: PatientProgressTrend;
  approvedVisitCount: number;
  summaryContent: string;
  latestApprovedAt?: string | Date | null;
  previousApprovedAt?: string | Date | null;
  generatedAt?: string | Date | null;
  updatedAt?: string | Date | null;
  keyChangesSinceLastVisit: string[];
  unresolvedIssues: string[];
  followUpProgress: string[];
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
  visitId: string;
  recipient: string;
  status: string;
  providerId?: string | null;
  error?: string | null;
  createdAt: string | Date;
};
