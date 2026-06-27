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
