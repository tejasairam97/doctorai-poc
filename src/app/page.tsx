"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  LogIn,
  Mail,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Stethoscope,
  UserPlus,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONSENT_STATUSES, INPUT_MODES, labelFromCode, type ConsentStatus, type InputMode } from "@/lib/status";
import type {
  EmailDeliveryLog,
  PatientHistoryResponse,
  PatientPortalProgressGroup,
  PatientPortalVisit,
  PatientSession,
  UsageEvent,
  VisitWithPatient
} from "@/lib/types";

type PublicDoctor = {
  id: string;
  name: string;
  email: string;
};

type MicState = "idle" | "prompting" | "listening" | "paused" | "denied" | "azure_unavailable" | "error";
type SummaryState = "idle" | "generating" | "ready" | "approving" | "approved" | "error";

type SpeechTokenResponse = {
  token: string;
  region: string;
  endpoint: string;
  expiresInSeconds: number;
  provider: "AZURE_SPEECH";
};

type SummaryResponse = {
  visit: VisitWithPatient;
  provider: "AZURE_OPENAI" | "LOCAL_PLACEHOLDER";
  simulated: boolean;
};

type ApproveResponse = {
  visit: VisitWithPatient;
  emailDeliveryLog?: EmailDeliveryLog;
  emailSimulated?: boolean;
  emailSkipped?: boolean;
  emailMessage?: string;
  emailError?: string;
};

type EmailResponse = {
  visit: VisitWithPatient;
  emailDeliveryLog: EmailDeliveryLog;
  emailSimulated?: boolean;
  emailError?: string;
};

type EmailTestResponse = {
  emailDeliveryLog: EmailDeliveryLog;
  emailSimulated?: boolean;
  acsConfigured: boolean;
  emailError?: string;
};

type PatientSessionResponse = {
  patientSession: PatientSession | null;
};

type PatientVisitsResponse = {
  visits: PatientPortalVisit[];
};

type PatientProgressResponse = {
  progress: PatientPortalProgressGroup[];
};

type RuntimeConfigResponse = {
  demoLogin: {
    enabled: boolean;
    email?: string;
    password?: string;
  };
};

type EmailConsentStatus = "APPROVED" | "DECLINED" | "NOT_ASKED";
type PatientHistoryTab = "VISIT_HISTORY" | "PROGRESS_SUMMARY";
type PublicAccessMode = "doctor" | "patient";
type AuthMode = "signup" | "login" | "forgot";
type DoctorLoginMethod = "password" | "otp";
type DoctorOtpStep = "EMAIL" | "CODE";
type ResetPasswordStep = "EMAIL" | "RESET";
type PatientOtpStep = "EMAIL" | "CODE";
type PatientPortalTab = "VISITS" | "PROGRESS";

const CLIENT_OTP_RESEND_COOLDOWN_SECONDS = 30;

type AzureRecognizer = {
  recognizing?: (sender: unknown, event: { result?: { text?: string } }) => void;
  recognized?: (sender: unknown, event: { result?: { text?: string } }) => void;
  canceled?: (sender: unknown, event: { errorDetails?: string }) => void;
  sessionStopped?: () => void;
  startContinuousRecognitionAsync: (success?: () => void, error?: (message: string) => void) => void;
  stopContinuousRecognitionAsync: (success?: () => void, error?: (message: string) => void) => void;
  close?: () => void;
};

const emptyVisitForm = {
  patientName: "",
  patientAge: "",
  patientEmail: "",
  patientPhone: "",
  consentStatus: "UNKNOWN" as ConsentStatus,
  inputModeRequested: "DOCTOR_SELF_SUMMARY" as InputMode
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const json = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(json?.error || `${response.status} ${response.statusText || "Request failed"}`.trim());
  }
  return json as T;
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength = 6
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <label className="block text-sm font-semibold text-ink">
      {label}
      <span className="relative mt-2 block">
        <input
          required
          minLength={minLength}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="h-12 w-full rounded-lg border border-mint bg-white px-3 pr-12 outline-none focus:border-moss"
        />
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-ink/65 hover:bg-clinic hover:text-ink"
        >
          {isVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

function isLiveAllowed(visit: VisitWithPatient | null) {
  return visit?.consentStatus === "GRANTED";
}

function canUseMicrophoneForMode(mode: InputMode, visit: VisitWithPatient | null) {
  return mode === "DOCTOR_SELF_SUMMARY" || isLiveAllowed(visit);
}

function chipTone(status: string) {
  if (status === "RECORDING") return "bg-coral text-white";
  if (status === "INTERRUPTED" || status === "EMAIL_FAILED") return "bg-amberline text-ink";
  if (status === "EMAILED" || status === "APPROVED") return "bg-moss text-white";
  if (status === "SUMMARIZED" || status === "TRANSCRIBED") return "bg-mint text-ink";
  return "bg-clinic text-moss";
}

function buildVisitChips(visit: VisitWithPatient, isRecordingActive = false) {
  const chips = new Set<string>();
  if (isRecordingActive || visit.status === "RECORDING") chips.add("RECORDING");
  if (visit.status === "INTERRUPTED") chips.add("INTERRUPTED");
  if (visit.status === "EMAIL_FAILED") chips.add("EMAIL_FAILED");
  if (visit.transcriptText?.trim()) chips.add("TRANSCRIBED");
  if (visit.draftSummary?.trim()) chips.add("SUMMARIZED");
  if (visit.approvedSummary?.trim()) chips.add("APPROVED");
  if (visit.emailedAt) chips.add("EMAILED");
  if (chips.size === 0) chips.add(visit.status);
  return Array.from(chips);
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-bold ${chipTone(status)}`}>
      {labelFromCode(status)}
    </span>
  );
}

function formatTimestamp(value?: string | Date | null) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function trendTone(trend: string) {
  if (trend === "improving") return "bg-moss text-white";
  if (trend === "stable") return "bg-mint text-ink";
  if (trend === "worsening") return "bg-coral text-white";
  if (trend === "mixed") return "bg-amberline text-ink";
  return "bg-clinic text-moss";
}

function confidenceTone(confidence: string) {
  if (confidence === "moderate") return "bg-moss text-white";
  if (confidence === "early signal") return "bg-amberline text-ink";
  if (confidence === "limited evidence") return "bg-clinic text-moss";
  return "bg-clinic text-ink";
}

function summaryPreview(summary?: string | null) {
  if (!summary?.trim()) return "No approved summary yet.";
  const words = summary.trim().split(/\s+/).slice(0, 24).join(" ");
  return summary.trim().split(/\s+/).length > 24 ? `${words}...` : words;
}

const SUMMARY_SECTION_HEADINGS = [
  "Patient concern",
  "Key history from conversation",
  "Doctor assessment/plan",
  "Follow-up / instructions"
];

function extractSummarySection(summary: string | null | undefined, heading: string) {
  if (!summary?.trim()) return "";

  const lines = summary.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (startIndex < 0) return "";

  const sectionLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    const cleaned = line.replace(/^[-*]\s*/, "").trim();
    if (!cleaned) continue;
    if (SUMMARY_SECTION_HEADINGS.some((knownHeading) => knownHeading.toLowerCase() === cleaned.toLowerCase())) break;
    sectionLines.push(cleaned);
  }

  return sectionLines.join(" ");
}

function visitConcern(visit: VisitWithPatient) {
  return extractSummarySection(visit.approvedSummary, "Patient concern") || "Patient concern was not documented.";
}

function visitFollowUp(visit: VisitWithPatient) {
  return extractSummarySection(visit.approvedSummary, "Follow-up / instructions") || "No follow-up documented.";
}

function PatientHistoryPanel({
  history,
  isLoading,
  error,
  tab,
  onTabChange,
  showEmptyState = false
}: {
  history: PatientHistoryResponse | null;
  isLoading: boolean;
  error: string;
  tab: PatientHistoryTab;
  onTabChange: (tab: PatientHistoryTab) => void;
  showEmptyState?: boolean;
}) {
  const [openSummaryVisitId, setOpenSummaryVisitId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-mint bg-clinic p-3 text-sm font-semibold text-ink">
        Checking patient history...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-lg bg-coral p-3 text-sm font-semibold text-white">{error}</div>;
  }

  if (!history) return null;

  const hasPriorVisits = history.priorVisitCount > 0;
  const progressSummary = history.progressSummary;

  if (!hasPriorVisits && !progressSummary) {
    return showEmptyState ? (
      <div className="rounded-lg border border-mint bg-clinic p-3 text-sm font-semibold text-ink">
        No prior visits found for this patient email under this doctor account.
      </div>
    ) : null;
  }

  const activeTab = tab;

  return (
    <div className="rounded-lg border border-mint bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">Patient history</p>
          <p className="text-xs font-semibold text-ink/65">
            {history.priorVisitCount} prior visit{history.priorVisitCount === 1 ? "" : "s"} with this doctor
          </p>
        </div>
        <span className="rounded-md bg-clinic px-2 py-1 text-xs font-bold text-moss">
          {history.approvedVisitCount} approved
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-clinic p-1">
        <button
          type="button"
          onClick={() => onTabChange("VISIT_HISTORY")}
          className={`h-9 rounded-md text-xs font-bold ${
            activeTab === "VISIT_HISTORY" ? "bg-white text-moss shadow-soft" : "text-ink"
          }`}
        >
          Visit History
        </button>
        <button
          type="button"
          onClick={() => onTabChange("PROGRESS_SUMMARY")}
          className={`h-9 rounded-md text-xs font-bold ${
            activeTab === "PROGRESS_SUMMARY" ? "bg-white text-moss shadow-soft" : "text-ink"
          }`}
        >
          AI Progress Summary
        </button>
      </div>
      {!progressSummary && (
        <p className="mt-2 text-xs font-semibold text-ink/60">
          AI Progress Summary appears after at least 2 approved visits for this patient.
        </p>
      )}

      {activeTab === "VISIT_HISTORY" ? (
        <div className="mt-3 space-y-2">
          {history.visits.map((visit) => (
            <div key={visit.id} className="rounded-lg border border-mint bg-clinic p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink">
                  {formatTimestamp(visit.createdAt)}
                  {visit.isCurrentVisit ? " - Current visit" : ""}
                </p>
                <StatusChip status={visit.status} />
              </div>
              <p className="mt-1 text-xs font-semibold text-ink/65">
                {visit.inputModeActual ? labelFromCode(visit.inputModeActual) : "Mode not recorded"}
              </p>
              <div className="mt-3 grid gap-2">
                <div>
                  <p className="text-xs font-bold uppercase text-moss">Patient issue / concern</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink/80">{visitConcern(visit)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-moss">Approved summary snippet</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink/80">{summaryPreview(visit.approvedSummary)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-moss">Follow-up from last time</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink/80">{visitFollowUp(visit)}</p>
                </div>
              </div>
              {visit.approvedSummary?.trim() && (
                <button
                  type="button"
                  onClick={() =>
                    setOpenSummaryVisitId((current) => (current === visit.id ? null : visit.id))
                  }
                  className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-xs font-bold text-ink"
                >
                  <FileText size={14} aria-hidden="true" />
                  {openSummaryVisitId === visit.id ? "Hide full summary" : "Open full summary"}
                </button>
              )}
              {openSummaryVisitId === visit.id && visit.approvedSummary?.trim() && (
                <div className="mt-3 rounded-lg bg-white p-3">
                  <p className="text-xs font-bold uppercase text-moss">Full approved summary</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {visit.approvedSummary}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {progressSummary ? (
            <>
              <div className="rounded-lg bg-clinic p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-ink">AI Progress Summary — Beta</p>
                    <p className="mt-1 text-xs font-semibold text-ink/65">
                      Generated from approved visit summaries only. Doctor review required.
                    </p>
                    {progressSummary.approvedVisitCount === 2 && (
                      <p className="mt-2 text-xs font-bold text-moss">
                        Early trend — only 2 approved visits available.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-md px-2 py-1 text-xs font-bold ${trendTone(progressSummary.trend)}`}>
                      {labelFromCode(progressSummary.trend)}
                    </span>
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-bold ${confidenceTone(
                        progressSummary.confidence
                      )}`}
                    >
                      {labelFromCode(progressSummary.confidence)}
                    </span>
                  </div>
                </div>
              </div>

              {[
                ["Timeline snapshot", progressSummary.timelineSnapshot],
                ["Key changes since last visit", progressSummary.keyChangesSinceLastVisit],
                ["Persistent or unresolved issues", progressSummary.unresolvedIssues],
                ["Follow-up progress / adherence", progressSummary.followUpProgress],
                ["Doctor review prompts", progressSummary.doctorReviewPrompts]
              ].map(([title, items]) => (
                <div key={title as string}>
                  <p className="text-sm font-bold text-ink">{title as string}</p>
                  <div className="mt-2 space-y-1">
                    {(items as string[]).length > 0 ? (
                      (items as string[]).map((item) => (
                        <p key={item} className="rounded-lg bg-clinic px-3 py-2 text-sm leading-relaxed text-ink/80">
                          {item}
                        </p>
                      ))
                    ) : (
                      <p className="rounded-lg bg-clinic px-3 py-2 text-sm leading-relaxed text-ink/70">
                        Not clearly documented in the approved summaries.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p className="rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">
              AI Progress Summary becomes available after at least 2 approved visits for this patient.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PatientHistoryBanner({
  history,
  isLoading,
  error,
  onOpen
}: {
  history: PatientHistoryResponse | null;
  isLoading: boolean;
  error: string;
  onOpen: () => void;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-mint bg-clinic p-3 text-sm font-semibold text-ink">
        Checking patient history...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-lg bg-coral p-3 text-sm font-semibold text-white">{error}</div>;
  }

  if (!history || history.priorVisitCount < 1) return null;

  return (
    <div className="rounded-lg border border-mint bg-clinic p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">Previous visits found</p>
          <p className="mt-1 text-xs font-semibold text-ink/65">
            {history.priorVisitCount} prior visit{history.priorVisitCount === 1 ? "" : "s"} with this doctor,
            {" "}
            {history.approvedVisitCount} approved.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="flex h-9 items-center gap-2 rounded-lg bg-moss px-3 text-xs font-bold text-white"
        >
          <ClipboardList size={14} aria-hidden="true" />
          Open history
        </button>
      </div>
    </div>
  );
}

function PatientHistoryModal({
  isOpen,
  onClose,
  patientEmail,
  history,
  isLoading,
  error,
  tab,
  onTabChange
}: {
  isOpen: boolean;
  onClose: () => void;
  patientEmail: string;
  history: PatientHistoryResponse | null;
  isLoading: boolean;
  error: string;
  tab: PatientHistoryTab;
  onTabChange: (tab: PatientHistoryTab) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/40 px-3 py-4 sm:items-center sm:justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Patient history"
        className="max-h-[88vh] w-full overflow-y-auto rounded-lg bg-white p-4 shadow-soft sm:max-w-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-mint pb-3">
          <div>
            <p className="text-sm font-bold text-moss">Patient history</p>
            <p className="mt-1 break-all text-xs font-semibold text-ink/65">{patientEmail}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-mint text-ink"
            aria-label="Close patient history"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3">
          <PatientHistoryPanel
            history={history}
            isLoading={isLoading}
            error={error}
            tab={tab}
            onTabChange={onTabChange}
            showEmptyState
          />
        </div>
      </div>
    </div>
  );
}

function emailConsentStatusFromVisit(visit: VisitWithPatient): EmailConsentStatus {
  if (
    visit.unencryptedEmailConsentStatus === "APPROVED" ||
    visit.unencryptedEmailConsentStatus === "DECLINED" ||
    visit.unencryptedEmailConsentStatus === "NOT_ASKED"
  ) {
    return visit.unencryptedEmailConsentStatus;
  }

  return visit.unencryptedEmailConsent ? "APPROVED" : "NOT_ASKED";
}

function parsePersistedDoctor(value: string | null): PublicDoctor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<PublicDoctor>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.email === "string"
    ) {
      return {
        id: parsed.id,
        name: parsed.name,
        email: parsed.email
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function clearDevelopmentPwaState() {
  if (process.env.NODE_ENV !== "development" || typeof navigator === "undefined") return;

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("doctorai"))
          .map((cacheName) => window.caches.delete(cacheName))
      );
    }
  } catch {
    // Development-only cleanup should never block app rendering.
  }
}

export default function Home() {
  const [doctor, setDoctor] = useState<PublicDoctor | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigResponse>({
    demoLogin: { enabled: false }
  });
  const [publicAccessMode, setPublicAccessMode] = useState<PublicAccessMode>("doctor");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [doctorLoginMethod, setDoctorLoginMethod] = useState<DoctorLoginMethod>("password");
  const [doctorOtpStep, setDoctorOtpStep] = useState<DoctorOtpStep>("EMAIL");
  const [doctorOtpCode, setDoctorOtpCode] = useState("");
  const [doctorOtpCooldown, setDoctorOtpCooldown] = useState(0);
  const [resetPasswordStep, setResetPasswordStep] = useState<ResetPasswordStep>("EMAIL");
  const [resetForm, setResetForm] = useState({ email: "", code: "", password: "", confirmPassword: "" });
  const [resetOtpCooldown, setResetOtpCooldown] = useState(0);
  const [patientSession, setPatientSession] = useState<PatientSession | null>(null);
  const [patientOtpStep, setPatientOtpStep] = useState<PatientOtpStep>("EMAIL");
  const [patientEmail, setPatientEmail] = useState("");
  const [patientOtpCode, setPatientOtpCode] = useState("");
  const [patientOtpCooldown, setPatientOtpCooldown] = useState(0);
  const [patientPortalTab, setPatientPortalTab] = useState<PatientPortalTab>("VISITS");
  const [patientPortalVisits, setPatientPortalVisits] = useState<PatientPortalVisit[]>([]);
  const [patientPortalProgress, setPatientPortalProgress] = useState<PatientPortalProgressGroup[]>([]);
  const [isLoadingPatientPortal, setIsLoadingPatientPortal] = useState(false);
  const [patientMessage, setPatientMessage] = useState("");
  const [patientError, setPatientError] = useState("");
  const [visitForm, setVisitForm] = useState(emptyVisitForm);
  const [visits, setVisits] = useState<VisitWithPatient[]>([]);
  const [activeVisit, setActiveVisit] = useState<VisitWithPatient | null>(null);
  const [activeMode, setActiveMode] = useState<InputMode>("DOCTOR_SELF_SUMMARY");
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [approvedSummaryDraft, setApprovedSummaryDraft] = useState("");
  const [summaryState, setSummaryState] = useState<SummaryState>("idle");
  const [summaryMessage, setSummaryMessage] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [testEmailMessage, setTestEmailMessage] = useState("");
  const [unencryptedEmailConsentStatus, setUnencryptedEmailConsentStatus] =
    useState<EmailConsentStatus>("NOT_ASKED");
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [showUsage, setShowUsage] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [newVisitHistory, setNewVisitHistory] = useState<PatientHistoryResponse | null>(null);
  const [newVisitHistoryTab, setNewVisitHistoryTab] = useState<PatientHistoryTab>("VISIT_HISTORY");
  const [isNewVisitHistoryOpen, setIsNewVisitHistoryOpen] = useState(false);
  const [isLoadingNewVisitHistory, setIsLoadingNewVisitHistory] = useState(false);
  const [newVisitHistoryError, setNewVisitHistoryError] = useState("");
  const [activeVisitHistory, setActiveVisitHistory] = useState<PatientHistoryResponse | null>(null);
  const [activeVisitHistoryTab, setActiveVisitHistoryTab] = useState<PatientHistoryTab>("VISIT_HISTORY");
  const [isLoadingActiveVisitHistory, setIsLoadingActiveVisitHistory] = useState(false);
  const [activeVisitHistoryError, setActiveVisitHistoryError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [micError, setMicError] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const activeVisitRef = useRef<VisitWithPatient | null>(null);
  const activeModeRef = useRef<InputMode>("DOCTOR_SELF_SUMMARY");
  const transcriptRef = useRef("");
  const dirtyRef = useRef(false);
  const recordingRef = useRef(false);
  const recognizerRef = useRef<AzureRecognizer | null>(null);
  const stoppingRecognizerRef = useRef(false);

  const liveAllowed = isLiveAllowed(activeVisit);
  const microphoneAllowed = canUseMicrophoneForMode(activeMode, activeVisit);
  const visitLocked = Boolean(activeVisit?.approvedSummary);
  const canViewUsage = Boolean(doctor?.email.endsWith("@doctorai.local"));

  const dashboardTitle = useMemo(() => {
    if (!doctor) return "DoctorAI";
    return visits.length === 1 ? "1 visit" : `${visits.length} visits`;
  }, [doctor, visits.length]);

  const dashboardStats = useMemo(
    () => ({
      interrupted: visits.filter((visit) => visit.status === "INTERRUPTED").length,
      summarized: visits.filter((visit) => Boolean(visit.draftSummary)).length,
      emailed: visits.filter((visit) => Boolean(visit.emailedAt)).length
    }),
    [visits]
  );

  const loadVisits = useCallback(
    async (doctorId: string, keepActiveVisitId?: string) => {
      const result = await api<{ visits: VisitWithPatient[] }>(`/api/visits?doctorId=${doctorId}`);
      setVisits(result.visits);
      if (keepActiveVisitId) {
        const refreshedActiveVisit = result.visits.find((visit) => visit.id === keepActiveVisitId);
        if (refreshedActiveVisit) {
          setActiveVisit(refreshedActiveVisit);
          setDraftSummary(refreshedActiveVisit.draftSummary || "");
          setApprovedSummaryDraft(refreshedActiveVisit.approvedSummary || refreshedActiveVisit.draftSummary || "");
          setUnencryptedEmailConsentStatus(emailConsentStatusFromVisit(refreshedActiveVisit));
        }
      }
      return result.visits;
    },
    []
  );

  const loadPatientHistory = useCallback(
    async (patientEmail: string, currentVisitId?: string, signal?: AbortSignal) => {
      if (!doctor) return null;

      const params = new URLSearchParams({
        doctorId: doctor.id,
        patientEmail: patientEmail.trim().toLowerCase()
      });
      if (currentVisitId) params.set("currentVisitId", currentVisitId);

      const result = await api<{ history: PatientHistoryResponse }>(`/api/patient-history?${params.toString()}`, {
        signal
      });
      return result.history;
    },
    [doctor]
  );

  const loadPatientPortalData = useCallback(async () => {
    setIsLoadingPatientPortal(true);
    try {
      const [visitsResult, progressResult] = await Promise.all([
        api<PatientVisitsResponse>("/api/patient/visits"),
        api<PatientProgressResponse>("/api/patient/progress")
      ]);
      setPatientPortalVisits(visitsResult.visits);
      setPatientPortalProgress(progressResult.progress);
    } finally {
      setIsLoadingPatientPortal(false);
    }
  }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    void clearDevelopmentPwaState();
    api<RuntimeConfigResponse>("/api/runtime-config")
      .then(setRuntimeConfig)
      .catch(() => setRuntimeConfig({ demoLogin: { enabled: false } }));

    const savedDoctor = window.localStorage.getItem("doctorai.doctor");
    const parsedDoctor = parsePersistedDoctor(savedDoctor);
    if (!parsedDoctor) {
      if (savedDoctor) {
        window.localStorage.removeItem("doctorai.doctor");
        setError("Saved login state was invalid. Please log in again.");
      }
      return;
    }

    setDoctor(parsedDoctor);
    loadVisits(parsedDoctor.id).catch(() => {
      window.localStorage.removeItem("doctorai.doctor");
      setDoctor(null);
      setError("Please log in again.");
    });
  }, [loadVisits]);

  useEffect(() => {
    api<PatientSessionResponse>("/api/patient/session")
      .then((result) => {
        if (!result.patientSession) return;
        setPatientSession(result.patientSession);
        setPatientEmail(result.patientSession.email);
        setPublicAccessMode("patient");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!patientSession) {
      setPatientPortalVisits([]);
      setPatientPortalProgress([]);
      return;
    }

    loadPatientPortalData().catch((portalError) => {
      setPatientError(portalError instanceof Error ? portalError.message : "Patient portal failed to load.");
    });
  }, [loadPatientPortalData, patientSession]);

  useEffect(() => {
    if (doctorOtpCooldown <= 0 && patientOtpCooldown <= 0 && resetOtpCooldown <= 0) return;

    const timer = window.setInterval(() => {
      setDoctorOtpCooldown((current) => Math.max(0, current - 1));
      setPatientOtpCooldown((current) => Math.max(0, current - 1));
      setResetOtpCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [doctorOtpCooldown, patientOtpCooldown, resetOtpCooldown]);

  useEffect(() => {
    if (!doctor || !showNewVisit) {
      setNewVisitHistory(null);
      setNewVisitHistoryError("");
      setIsLoadingNewVisitHistory(false);
      setIsNewVisitHistoryOpen(false);
      return;
    }

    const patientEmail = visitForm.patientEmail.trim().toLowerCase();
    if (!patientEmail || !patientEmail.includes("@")) {
      setNewVisitHistory(null);
      setNewVisitHistoryError("");
      setIsLoadingNewVisitHistory(false);
      setIsNewVisitHistoryOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsLoadingNewVisitHistory(true);
      setNewVisitHistoryError("");
      loadPatientHistory(patientEmail, undefined, controller.signal)
        .then((history) => {
          if (controller.signal.aborted) return;
          setNewVisitHistory(history);
          if (history?.progressSummary) setNewVisitHistoryTab("PROGRESS_SUMMARY");
          else setNewVisitHistoryTab("VISIT_HISTORY");
          if (!history || history.priorVisitCount < 1) setIsNewVisitHistoryOpen(false);
        })
        .catch((historyError) => {
          if (controller.signal.aborted) return;
          setNewVisitHistory(null);
          setNewVisitHistoryError(
            historyError instanceof Error ? historyError.message : "Patient history lookup failed."
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoadingNewVisitHistory(false);
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [doctor, loadPatientHistory, showNewVisit, visitForm.patientEmail]);

  useEffect(() => {
    if (!doctor || !activeVisit) {
      setActiveVisitHistory(null);
      setActiveVisitHistoryError("");
      setIsLoadingActiveVisitHistory(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingActiveVisitHistory(true);
    setActiveVisitHistoryError("");

    loadPatientHistory(activeVisit.patient.email, activeVisit.id, controller.signal)
      .then((history) => {
        if (controller.signal.aborted) return;
        setActiveVisitHistory(history);
        if (!history?.progressSummary) setActiveVisitHistoryTab("VISIT_HISTORY");
      })
      .catch((historyError) => {
        if (controller.signal.aborted) return;
        setActiveVisitHistory(null);
        setActiveVisitHistoryError(
          historyError instanceof Error ? historyError.message : "Patient history lookup failed."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingActiveVisitHistory(false);
      });

    return () => controller.abort();
  }, [
    doctor,
    loadPatientHistory,
    activeVisit?.id,
    activeVisit?.patient.email,
    activeVisit?.approvedAt,
    visits.length
  ]);

  useEffect(() => {
    activeVisitRef.current = activeVisit;
  }, [activeVisit]);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    recordingRef.current = isRecording;
  }, [isRecording]);

  const stopAzureRecognizer = useCallback(async () => {
    const recognizer = recognizerRef.current;
    if (!recognizer) return;

    stoppingRecognizerRef.current = true;
    await new Promise<void>((resolve) => {
      recognizer.stopContinuousRecognitionAsync(
        () => resolve(),
        () => resolve()
      );
    });
    recognizer.close?.();
    recognizerRef.current = null;
    stoppingRecognizerRef.current = false;
    setInterimText("");
  }, []);

  const appendRecognizedText = useCallback((text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;

    setTranscript((current) => {
      const next = `${current}${current.trim() ? "\n" : ""}${cleaned}`;
      transcriptRef.current = next;
      dirtyRef.current = true;
      return next;
    });
  }, []);

  const saveTranscript = useCallback(
    async (status?: string, modeOverride?: InputMode) => {
      const visit = activeVisitRef.current;
      if (!visit || !doctor) return;

      setIsSaving(true);
      try {
        const mode = modeOverride ?? activeModeRef.current;
        const result = await api<{ visit: VisitWithPatient }>(`/api/visits/${visit.id}/transcript`, {
          method: "POST",
          body: JSON.stringify({
            transcriptText: transcriptRef.current,
            inputModeActual: mode,
            status
          })
        });
        setActiveVisit(result.visit);
        dirtyRef.current = false;
        setLastSavedAt(new Date().toLocaleTimeString());
        await loadVisits(doctor.id, result.visit.id);
      } finally {
        setIsSaving(false);
      }
    },
    [doctor, loadVisits]
  );

  const markInterrupted = useCallback(
    async (reason: string) => {
      const visit = activeVisitRef.current;
      if (!visit || !doctor || !recordingRef.current) return;

      await stopAzureRecognizer();
      setIsRecording(false);
      setMicState("paused");

      const result = await api<{ visit: VisitWithPatient }>(`/api/visits/${visit.id}/interrupt`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          transcriptText: transcriptRef.current,
          inputModeActual: activeModeRef.current
        })
      });

      setActiveVisit(result.visit);
      setNotice("Visit interrupted. Latest transcript text was saved.");
      setError("");
      dirtyRef.current = false;
      setLastSavedAt(new Date().toLocaleTimeString());
      await loadVisits(doctor.id, result.visit.id);
    },
    [doctor, loadVisits, stopAzureRecognizer]
  );

  useEffect(() => {
    const autosave = window.setInterval(() => {
      if (activeVisitRef.current && dirtyRef.current) {
        const status =
          activeModeRef.current === "DOCTOR_SELF_SUMMARY" && !recordingRef.current
            ? "READY_FOR_DOCUMENTATION"
            : recordingRef.current
              ? "RECORDING"
              : activeVisitRef.current.status;
        saveTranscript(status).catch((saveError) => setError(saveError.message));
      }
    }, 4000);

    const onVisibilityChange = () => {
      if (document.hidden) {
        markInterrupted("page_hidden").catch((interruptError) => setError(interruptError.message));
      }
    };

    const onOffline = () => {
      setIsOnline(false);
      markInterrupted("network_offline").catch((interruptError) => setError(interruptError.message));
    };

    const onOnline = () => {
      setIsOnline(true);
      setNotice("Back online.");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      window.clearInterval(autosave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      void stopAzureRecognizer();
    };
  }, [markInterrupted, saveTranscript, stopAzureRecognizer]);

  async function selectVisit(visit: VisitWithPatient) {
    await stopAzureRecognizer();
    setIsRecording(false);
    setActiveVisit(visit);
    const nextMode =
      visit.inputModeActual === "LIVE_CONVERSATION" && visit.consentStatus === "GRANTED"
        ? "LIVE_CONVERSATION"
        : "DOCTOR_SELF_SUMMARY";
    setActiveMode(nextMode);
    setTranscript(visit.transcriptText || "");
    transcriptRef.current = visit.transcriptText || "";
    setDraftSummary(visit.draftSummary || "");
    setApprovedSummaryDraft(visit.approvedSummary || visit.draftSummary || "");
    setUnencryptedEmailConsentStatus(emailConsentStatusFromVisit(visit));
    setSummaryState(visit.approvedSummary ? "approved" : visit.draftSummary ? "ready" : "idle");
    setSummaryMessage("");
    setEmailMessage(visit.emailedAt ? `Emailed ${formatTimestamp(visit.emailedAt)}` : "");
    dirtyRef.current = false;
    setInterimText("");
    setMicState("idle");
    setMicError("");
    setNotice("");
    setError("");
  }

  function useDemoCredentials() {
    if (!runtimeConfig.demoLogin.enabled || !runtimeConfig.demoLogin.email || !runtimeConfig.demoLogin.password) {
      setError("Demo login is disabled for this environment.");
      return;
    }

    setAuthMode("login");
    setDoctorLoginMethod("password");
    setDoctorOtpStep("EMAIL");
    setDoctorOtpCode("");
    setAuthForm({
      name: "",
      email: runtimeConfig.demoLogin.email,
      password: runtimeConfig.demoLogin.password
    });
    setError("");
    setNotice("Demo credentials filled.");
  }

  async function enterDoctorApp(nextDoctor: PublicDoctor, message: string) {
    setDoctor(nextDoctor);
    window.localStorage.setItem("doctorai.doctor", JSON.stringify(nextDoctor));
    const nextVisits = await loadVisits(nextDoctor.id);
    if (nextVisits[0]) await selectVisit(nextVisits[0]);
    setNotice(message);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsBusy(true);

    try {
      const result = await api<{ doctor: PublicDoctor }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ ...authForm, mode: authMode })
      });
      await enterDoctorApp(result.doctor, authMode === "signup" ? "Account created." : "Welcome back.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function sendDoctorOtpCode() {
    const normalizedEmail = authForm.email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setError("Enter a valid doctor email.");
      return;
    }

    setError("");
    setNotice("");
    setIsBusy(true);

    try {
      const result = await api<{ ok: boolean; message: string }>("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail })
      });
      setAuthForm({ ...authForm, email: normalizedEmail });
      setDoctorOtpStep("CODE");
      setDoctorOtpCooldown(CLIENT_OTP_RESEND_COOLDOWN_SECONDS);
      setNotice(result.message || "If an account exists, a code has been sent.");
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Unable to request a login code.");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestDoctorOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendDoctorOtpCode();
  }

  async function verifyDoctorOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = authForm.email.trim().toLowerCase();
    const code = doctorOtpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }

    setError("");
    setNotice("");
    setIsBusy(true);

    try {
      const result = await api<{ doctor: PublicDoctor }>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, code })
      });
      setDoctorOtpCode("");
      await enterDoctorApp(result.doctor, "Welcome back.");
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Verification failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function sendPasswordResetCode() {
    const normalizedEmail = resetForm.email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setError("Enter a valid doctor email.");
      return;
    }

    setError("");
    setNotice("");
    setIsBusy(true);

    try {
      const result = await api<{ ok: boolean; message: string }>("/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail })
      });
      setResetForm({ ...resetForm, email: normalizedEmail });
      setResetPasswordStep("RESET");
      setResetOtpCooldown(CLIENT_OTP_RESEND_COOLDOWN_SECONDS);
      setNotice(result.message || "If an account exists, a reset code has been sent.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to request a reset code.");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendPasswordResetCode();
  }

  async function confirmPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = resetForm.email.trim().toLowerCase();
    const code = resetForm.code.trim();
    const password = resetForm.password;

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit reset code.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== resetForm.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setNotice("");
    setIsBusy(true);

    try {
      const result = await api<{ doctor: PublicDoctor; message: string }>("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          code,
          password
        })
      });
      setResetForm({ email: "", code: "", password: "", confirmPassword: "" });
      setResetPasswordStep("EMAIL");
      await enterDoctorApp(result.doctor, result.message || "Password reset. You are signed in.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Password reset failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function createVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doctor) return;

    setError("");
    setNotice("");
    setIsBusy(true);

    try {
      const result = await api<{ visit: VisitWithPatient }>("/api/visits", {
        method: "POST",
        body: JSON.stringify({
          doctorId: doctor.id,
          patientName: visitForm.patientName,
          patientAge: Number(visitForm.patientAge),
          patientEmail: visitForm.patientEmail,
          patientPhone: visitForm.patientPhone,
          consentStatus: visitForm.consentStatus,
          inputModeRequested: visitForm.inputModeRequested
        })
      });
      setVisitForm(emptyVisitForm);
      setShowNewVisit(false);
      await selectVisit(result.visit);
      await loadVisits(doctor.id, result.visit.id);
      setNotice("Draft visit created.");
    } catch (visitError) {
      setError(visitError instanceof Error ? visitError.message : "Visit creation failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestSpeechToken(mode: InputMode) {
    const visit = activeVisitRef.current;
    if (!doctor || !visit) throw new Error("Select a visit before starting transcription.");

    return api<SpeechTokenResponse>("/api/speech-token", {
      method: "POST",
      body: JSON.stringify({
        doctorId: doctor.id,
        visitId: visit.id,
        inputModeActual: mode
      })
    });
  }

  async function loadUsage() {
    if (!doctor || !canViewUsage) return;
    setIsLoadingUsage(true);
    try {
      const result = await api<{ usageEvents: UsageEvent[] }>(`/api/usage?limit=18&doctorId=${doctor.id}`);
      setUsageEvents(result.usageEvents);
    } finally {
      setIsLoadingUsage(false);
    }
  }

  async function generateSummary(saveFirst = true) {
    const visit = activeVisitRef.current;
    if (!visit || !doctor) return;

    if (!transcriptRef.current.trim()) {
      setSummaryState("error");
      setSummaryMessage("Add transcript or Doctor Self-Summary text before generating a summary.");
      return;
    }

    setSummaryState("generating");
    setSummaryMessage("");
    setEmailMessage("");
    setError("");

    try {
      if (saveFirst) {
        await saveTranscript("TRANSCRIBED", activeModeRef.current);
      }

      const result = await api<SummaryResponse>(`/api/visits/${visit.id}/summary`, {
        method: "POST"
      });

      setActiveVisit(result.visit);
      setDraftSummary(result.visit.draftSummary || "");
      setApprovedSummaryDraft(result.visit.draftSummary || "");
      setUnencryptedEmailConsentStatus(emailConsentStatusFromVisit(result.visit));
      setSummaryState("ready");
      setSummaryMessage(
        result.simulated
          ? "Draft summary generated with local placeholder mode. Add Azure OpenAI keys to use the real model."
          : "Draft summary generated with Azure OpenAI."
      );
      await loadVisits(doctor.id, result.visit.id);
      if (showUsage) await loadUsage();
    } catch (summaryError) {
      setSummaryState("error");
      setSummaryMessage(summaryError instanceof Error ? summaryError.message : "Summary generation failed.");
    }
  }

  async function approveSummary() {
    const visit = activeVisitRef.current;
    if (!visit || !doctor) return;

    const summaryToApprove = approvedSummaryDraft.trim();
    if (!summaryToApprove) {
      setSummaryState("error");
      setSummaryMessage("Generate or enter a draft summary before approval.");
      return;
    }

    setSummaryState("approving");
    setSummaryMessage("");
    setEmailMessage("");
    setError("");

    try {
      const result = await api<ApproveResponse>(`/api/visits/${visit.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          approvedSummary: summaryToApprove,
          unencryptedEmailConsentStatus
        })
      });

      setActiveVisit(result.visit);
      setDraftSummary(result.visit.draftSummary || "");
      setApprovedSummaryDraft(result.visit.approvedSummary || summaryToApprove);
      setUnencryptedEmailConsentStatus(emailConsentStatusFromVisit(result.visit));
      setSummaryState("approved");
      setSummaryMessage("Summary approved and saved as the final version.");
      if (result.emailError) {
        setEmailMessage(result.emailError);
      } else if (result.emailSimulated) {
        setEmailMessage("Summary approved. Secure link email was logged as simulated because ACS is not configured.");
      } else if (result.emailDeliveryLog || result.visit.emailedAt) {
        setEmailMessage("Summary approved. Secure summary link sent to the patient email.");
      } else {
        setEmailMessage(
          result.emailMessage || "Summary approved but not emailed. Send Secure Link is available after email consent."
        );
      }
      await loadVisits(doctor.id, result.visit.id);
      if (showUsage) await loadUsage();
    } catch (approvalError) {
      setSummaryState("error");
      setSummaryMessage(approvalError instanceof Error ? approvalError.message : "Approval failed.");
    }
  }

  async function sendEmail() {
    const visit = activeVisitRef.current;
    if (!visit || !doctor) return;

    if (!visit.approvedSummary) {
      setEmailMessage("Approve the summary before sending email.");
      return;
    }

    setIsBusy(true);
    setEmailMessage("");
    setError("");

    try {
      const result = await api<EmailResponse>(`/api/visits/${visit.id}/email`, {
        method: "POST",
        body: JSON.stringify({ unencryptedEmailConsentStatus })
      });

      setActiveVisit(result.visit);
      setUnencryptedEmailConsentStatus(emailConsentStatusFromVisit(result.visit));
      setEmailMessage(
        result.emailError ||
          (result.emailSimulated
            ? "Email logged as simulated because ACS placeholders are still configured."
            : "Secure summary link sent to the patient email.")
      );
      await loadVisits(doctor.id, result.visit.id);
      if (showUsage) await loadUsage();
    } catch (emailError) {
      setEmailMessage(emailError instanceof Error ? emailError.message : "Email sending failed.");
      if (doctor) await loadVisits(doctor.id, visit.id);
    } finally {
      setIsBusy(false);
    }
  }

  async function sendTestEmailToSelf() {
    if (!doctor) return;

    setIsSendingTestEmail(true);
    setTestEmailMessage("");
    setError("");

    try {
      const result = await api<EmailTestResponse>("/api/email-test", {
        method: "POST",
        body: JSON.stringify({ doctorId: doctor.id })
      });

      if (result.emailError) {
        setTestEmailMessage(result.emailError);
      } else if (!result.acsConfigured || result.emailSimulated) {
        setTestEmailMessage("ACS not configured. Test email was logged as simulated.");
      } else {
        setTestEmailMessage("Test email sent to your doctor email.");
      }

      if (showUsage) await loadUsage();
    } catch (testEmailError) {
      setTestEmailMessage(testEmailError instanceof Error ? testEmailError.message : "Email failed.");
    } finally {
      setIsSendingTestEmail(false);
    }
  }

  async function sendPatientOtpCode() {
    const normalizedEmail = patientEmail.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setPatientError("Enter a valid email.");
      return;
    }

    setIsBusy(true);
    setPatientError("");
    setPatientMessage("");

    try {
      await api<{ ok: boolean; message: string }>("/api/otp/request", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          role_context: "patient"
        })
      });
      setPatientEmail(normalizedEmail);
      setPatientOtpStep("CODE");
      setPatientOtpCooldown(CLIENT_OTP_RESEND_COOLDOWN_SECONDS);
      setPatientMessage("If that email has access, a verification code has been sent.");
    } catch (otpError) {
      setPatientError(otpError instanceof Error ? otpError.message : "Unable to request verification code.");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestPatientOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendPatientOtpCode();
  }

  async function verifyPatientOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = patientEmail.trim().toLowerCase();
    const code = patientOtpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setPatientError("Enter the 6-digit code.");
      return;
    }

    setIsBusy(true);
    setPatientError("");
    setPatientMessage("");

    try {
      const result = await api<{ verified: boolean; patientSession: PatientSession | null }>("/api/otp/verify", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          role_context: "patient",
          code
        })
      });

      if (!result.patientSession) {
        throw new Error("Patient session was not created.");
      }

      setPatientSession(result.patientSession);
      setPatientOtpCode("");
      setPatientMessage("Patient access verified.");
      await loadPatientPortalData();
    } catch (otpError) {
      setPatientError(otpError instanceof Error ? otpError.message : "Verification failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function logoutPatient() {
    setIsBusy(true);
    setPatientError("");
    setPatientMessage("");

    try {
      await api<{ ok: boolean }>("/api/patient/logout", { method: "POST" });
      setPatientSession(null);
      setPatientOtpStep("EMAIL");
      setPatientOtpCode("");
      setPatientPortalVisits([]);
      setPatientPortalProgress([]);
      setPatientMessage("Signed out.");
    } catch (logoutError) {
      setPatientError(logoutError instanceof Error ? logoutError.message : "Sign out failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function startRecording() {
    const visit = activeVisitRef.current;
    const mode = activeModeRef.current;
    if (!visit || !doctor) return;

    if (visit.approvedSummary) {
      setMicState("error");
      setMicError("This visit already has an approved final summary.");
      return;
    }

    if (!canUseMicrophoneForMode(mode, visit)) {
      setMicState("error");
      setMicError("Live Conversation requires granted recording consent. Doctor Self-Summary remains available.");
      return;
    }

    const secureEnough =
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!secureEnough) {
      setMicState("error");
      setMicError("Microphone access requires HTTPS or localhost.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicState("error");
      setMicError("This browser does not expose microphone capture APIs.");
      return;
    }

    setIsBusy(true);
    setError("");
    setNotice("");
    setMicError("");
    setMicState("prompting");

    try {
      let tokenResponse: SpeechTokenResponse;
      try {
        tokenResponse = await requestSpeechToken(mode);
      } catch (tokenError) {
        setMicState("azure_unavailable");
        setMicError(
          tokenError instanceof Error
            ? `${tokenError.message} Add Azure Speech settings, then retry.`
            : "Azure Speech is unavailable. Add Azure Speech settings, then retry."
        );
        return;
      }

      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());

      const speechSdk = await import("microsoft-cognitiveservices-speech-sdk");
      const speechConfig = speechSdk.SpeechConfig.fromAuthorizationToken(tokenResponse.token, tokenResponse.region);
      speechConfig.speechRecognitionLanguage = "en-US";
      const audioConfig = speechSdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new speechSdk.SpeechRecognizer(speechConfig, audioConfig) as unknown as AzureRecognizer;

      recognizer.recognizing = (_sender, event) => {
        setInterimText(event.result?.text?.trim() || "");
      };

      recognizer.recognized = (_sender, event) => {
        setInterimText("");
        appendRecognizedText(event.result?.text || "");
      };

      recognizer.canceled = (_sender, event) => {
        if (stoppingRecognizerRef.current) return;
        setMicState("error");
        setMicError(event.errorDetails || "Azure Speech recognition stopped unexpectedly.");
        markInterrupted("azure_speech_canceled").catch((interruptError) => setError(interruptError.message));
      };

      recognizer.sessionStopped = () => {
        if (stoppingRecognizerRef.current) return;
        setIsRecording(false);
        recordingRef.current = false;
        setMicState("paused");
      };

      recognizerRef.current = recognizer;
      await new Promise<void>((resolve, reject) => {
        recognizer.startContinuousRecognitionAsync(resolve, (message) => reject(new Error(message)));
      });

      setActiveMode(mode);
      activeModeRef.current = mode;
      setIsRecording(true);
      recordingRef.current = true;
      setMicState("listening");
      await saveTranscript("RECORDING", mode);
    } catch (recordingError) {
      await stopAzureRecognizer();
      setIsRecording(false);
      recordingRef.current = false;
      const isDenied = recordingError instanceof DOMException && recordingError.name === "NotAllowedError";
      setMicState(isDenied ? "denied" : "error");
      setMicError(
        isDenied
          ? "Microphone permission was denied. You can still use Doctor Self-Summary."
          : recordingError instanceof Error
            ? `${recordingError.message} You can retry without changing this visit.`
            : "Azure Speech transcription failed. You can retry without changing this visit."
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function pauseRecording(generateAfterStop = true) {
    const mode = activeModeRef.current;
    setIsBusy(true);
    try {
      await stopAzureRecognizer();
      setIsRecording(false);
      recordingRef.current = false;
      setMicState("paused");
      await saveTranscript("TRANSCRIBED", mode);
      setNotice("Transcription stopped and transcript saved.");
      if (generateAfterStop && transcriptRef.current.trim()) {
        await generateSummary(false);
      } else if (generateAfterStop) {
        setSummaryState("idle");
        setSummaryMessage("Transcript saved. Add text before generating a summary.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function resumeRecording() {
    const visit = activeVisitRef.current;
    if (!visit) return;

    const wasInterrupted = visit.status === "INTERRUPTED";
    const mode = activeModeRef.current;
    await startRecording();

    if (wasInterrupted && recordingRef.current && doctor) {
      const result = await api<{ visit: VisitWithPatient }>(`/api/visits/${visit.id}/resume`, {
        method: "POST",
        body: JSON.stringify({ inputModeActual: mode })
      });
      setActiveVisit(result.visit);
      await loadVisits(doctor.id, result.visit.id);
    }
  }

  async function switchToSelfSummary() {
    if (activeVisitRef.current?.approvedSummary) return;
    if (recordingRef.current) await pauseRecording(false);
    setActiveMode("DOCTOR_SELF_SUMMARY");
    activeModeRef.current = "DOCTOR_SELF_SUMMARY";
    await saveTranscript("READY_FOR_DOCUMENTATION", "DOCTOR_SELF_SUMMARY");
    setNotice("Doctor Self-Summary is active.");
  }

  async function switchToLive() {
    if (!activeVisit || !liveAllowed || activeVisit.approvedSummary) return;
    if (recordingRef.current) await pauseRecording(false);
    setActiveMode("LIVE_CONVERSATION");
    activeModeRef.current = "LIVE_CONVERSATION";
    await saveTranscript(activeVisit.status, "LIVE_CONVERSATION");
  }

  if (!doctor) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-5 py-8">
        <section className="space-y-7">
          <div className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-moss text-white">
              <Stethoscope size={25} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">DoctorAI</p>
              <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">Clinical documentation</h1>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-1 shadow-soft">
            {(["doctor", "patient"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setPublicAccessMode(mode);
                  setError("");
                  setNotice("");
                  setPatientError("");
                  setPatientMessage("");
                }}
                className={`h-11 rounded-md text-sm font-semibold ${
                  publicAccessMode === mode ? "bg-moss text-white" : "text-ink"
                }`}
              >
                {mode === "doctor" ? "Doctor Access" : "Patient Access"}
              </button>
            ))}
          </div>

          {publicAccessMode === "doctor" ? (
            <div className="space-y-5 rounded-lg bg-white p-4 shadow-soft">
              <div>
                <h2 className="text-xl font-bold text-ink">Doctor Access</h2>
                <p className="mt-1 text-sm font-semibold text-ink/65">
                  Sign in with your password or a one-time email code.
                </p>
              </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-1 shadow-soft">
            {(["signup", "login"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAuthMode(mode);
                  if (mode === "signup") setDoctorLoginMethod("password");
                  setDoctorOtpStep("EMAIL");
                  setDoctorOtpCode("");
                  setError("");
                  setNotice("");
                }}
                className={`h-11 rounded-md text-sm font-semibold ${
                  authMode === mode ? "bg-moss text-white" : "text-ink"
                }`}
              >
                {mode === "signup" ? "Sign up" : "Log in"}
              </button>
            ))}
          </div>

          {authMode === "login" && (
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-1 shadow-soft">
              {([
                ["password", "Password"],
                ["otp", "Login with email code"]
              ] as const).map(([method, label]) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => {
                    setDoctorLoginMethod(method);
                    setDoctorOtpStep("EMAIL");
                    setDoctorOtpCode("");
                    setError("");
                    setNotice("");
                  }}
                  className={`min-h-11 rounded-md px-2 text-sm font-semibold ${
                    doctorLoginMethod === method ? "bg-moss text-white" : "text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {authMode === "forgot" ? (
            resetPasswordStep === "EMAIL" ? (
              <form onSubmit={requestPasswordReset} className="space-y-4">
                <div className="rounded-lg bg-clinic px-3 py-3 text-sm font-semibold text-ink">
                  Enter your doctor account email. If an account exists, we will send a reset code.
                </div>
                <label className="block text-sm font-semibold text-ink">
                  Doctor email
                  <input
                    required
                    type="email"
                    value={resetForm.email}
                    onChange={(event) => setResetForm({ ...resetForm, email: event.target.value })}
                    className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 outline-none focus:border-moss"
                  />
                </label>
                {error && <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{error}</p>}
                {notice && <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{notice}</p>}
                <button
                  disabled={isBusy}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
                >
                  <KeyRound size={18} aria-hidden="true" />
                  Send reset code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("login");
                    setResetPasswordStep("EMAIL");
                    setResetForm({ email: resetForm.email, code: "", password: "", confirmPassword: "" });
                    setError("");
                    setNotice("");
                  }}
                  className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink"
                >
                  Back to login
                </button>
              </form>
            ) : (
              <form onSubmit={confirmPasswordReset} className="space-y-4">
                <div className="rounded-lg bg-clinic px-3 py-3 text-sm font-semibold text-ink">
                  If an account exists, the reset code was sent to {resetForm.email.trim().toLowerCase()}.
                </div>
                <label className="block text-sm font-semibold text-ink">
                  Reset code
                  <input
                    required
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={resetForm.code}
                    onChange={(event) =>
                      setResetForm({ ...resetForm, code: event.target.value.replace(/\D/g, "").slice(0, 6) })
                    }
                    className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 text-center text-lg font-bold tracking-[0.25em] outline-none focus:border-moss"
                  />
                </label>
                <PasswordInput
                  label="New password"
                  value={resetForm.password}
                  onChange={(password) => setResetForm({ ...resetForm, password })}
                  autoComplete="new-password"
                />
                <PasswordInput
                  label="Confirm new password"
                  value={resetForm.confirmPassword}
                  onChange={(confirmPassword) => setResetForm({ ...resetForm, confirmPassword })}
                  autoComplete="new-password"
                />
                {error && <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{error}</p>}
                {notice && <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{notice}</p>}
                <button
                  disabled={isBusy}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
                >
                  <KeyRound size={18} aria-hidden="true" />
                  Reset password
                </button>
                <button
                  type="button"
                  disabled={isBusy || resetOtpCooldown > 0}
                  onClick={sendPasswordResetCode}
                  className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink disabled:opacity-60"
                >
                  {resetOtpCooldown > 0 ? `Resend code in ${resetOtpCooldown}s` : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetPasswordStep("EMAIL");
                    setResetForm({ ...resetForm, code: "", password: "", confirmPassword: "" });
                    setError("");
                    setNotice("");
                  }}
                  className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink"
                >
                  Use a different email
                </button>
              </form>
            )
          ) : authMode === "signup" || doctorLoginMethod === "password" ? (
            <form onSubmit={submitAuth} className="space-y-4">
              {authMode === "signup" && (
                <label className="block text-sm font-semibold text-ink">
                  Name
                  <input
                    required
                    value={authForm.name}
                    onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                    className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 outline-none focus:border-moss"
                  />
                </label>
              )}
              <label className="block text-sm font-semibold text-ink">
                Email
                <input
                  required
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 outline-none focus:border-moss"
                />
              </label>
              <PasswordInput
                label="Password"
                value={authForm.password}
                onChange={(password) => setAuthForm({ ...authForm, password })}
                autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              />
              {authMode === "login" && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("forgot");
                    setResetPasswordStep("EMAIL");
                    setResetForm({
                      email: authForm.email.trim().toLowerCase(),
                      code: "",
                      password: "",
                      confirmPassword: ""
                    });
                    setError("");
                    setNotice("");
                  }}
                  className="text-sm font-bold text-moss"
                >
                  Forgot password?
                </button>
              )}
              {runtimeConfig.demoLogin.enabled && runtimeConfig.demoLogin.email && runtimeConfig.demoLogin.password && (
                <>
                  <button
                    type="button"
                    onClick={useDemoCredentials}
                    className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink"
                  >
                    Use demo login
                  </button>
                  <p className="rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">
                    Demo: {runtimeConfig.demoLogin.email} / {runtimeConfig.demoLogin.password}
                  </p>
                </>
              )}
              {error && <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{error}</p>}
              {notice && <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{notice}</p>}
              <button
                disabled={isBusy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
              >
                {authMode === "signup" ? <UserPlus size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}
                {authMode === "signup" ? "Create account" : "Enter app"}
              </button>
            </form>
          ) : doctorOtpStep === "EMAIL" ? (
            <form onSubmit={requestDoctorOtp} className="space-y-4">
              <label className="block text-sm font-semibold text-ink">
                Doctor email
                <input
                  required
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 outline-none focus:border-moss"
                />
              </label>
              {error && <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{error}</p>}
              {notice && <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{notice}</p>}
              <button
                disabled={isBusy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
              >
                <Mail size={18} aria-hidden="true" />
                Send code
              </button>
            </form>
          ) : (
            <form onSubmit={verifyDoctorOtp} className="space-y-4">
              <div className="rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">
                If an account exists, the code was sent to {authForm.email.trim().toLowerCase()}.
              </div>
              <label className="block text-sm font-semibold text-ink">
                Verification code
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={doctorOtpCode}
                  onChange={(event) => setDoctorOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 text-center text-lg font-bold tracking-[0.25em] outline-none focus:border-moss"
                />
              </label>
              {error && <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{error}</p>}
              {notice && <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{notice}</p>}
              <button
                disabled={isBusy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
              >
                <LogIn size={18} aria-hidden="true" />
                Verify and enter app
              </button>
              <button
                type="button"
                disabled={isBusy || doctorOtpCooldown > 0}
                onClick={sendDoctorOtpCode}
                className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink disabled:opacity-60"
              >
                {doctorOtpCooldown > 0 ? `Resend code in ${doctorOtpCooldown}s` : "Resend code"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDoctorOtpStep("EMAIL");
                  setDoctorOtpCode("");
                  setNotice("");
                  setError("");
                }}
                className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink"
              >
                Use a different email
              </button>
            </form>
          )}
            </div>
          ) : (
            <div className="rounded-lg bg-white p-4 shadow-soft">
              {!patientSession ? (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-ink">Patient Access</h2>
                    <p className="mt-1 text-sm font-semibold text-ink/65">
                      View approved visit summaries using the email shared with your doctor.
                    </p>
                  </div>

                  {patientOtpStep === "EMAIL" ? (
                    <form onSubmit={requestPatientOtp} className="space-y-4">
                      <label className="block text-sm font-semibold text-ink">
                        Email
                        <input
                          required
                          type="email"
                          value={patientEmail}
                          onChange={(event) => setPatientEmail(event.target.value)}
                          className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 outline-none focus:border-moss"
                        />
                      </label>
                      <button
                        disabled={isBusy}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
                      >
                        <Mail size={18} aria-hidden="true" />
                        Send code
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={verifyPatientOtp} className="space-y-4">
                      <label className="block text-sm font-semibold text-ink">
                        Verification code
                        <input
                          required
                          inputMode="numeric"
                          maxLength={6}
                          pattern="[0-9]{6}"
                          value={patientOtpCode}
                          onChange={(event) => setPatientOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                          className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 text-center text-lg font-bold tracking-[0.25em] outline-none focus:border-moss"
                        />
                      </label>
                      <button
                        disabled={isBusy}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss font-semibold text-white"
                      >
                        <LogIn size={18} aria-hidden="true" />
                        Verify
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || patientOtpCooldown > 0}
                        onClick={sendPatientOtpCode}
                        className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink disabled:opacity-60"
                      >
                        {patientOtpCooldown > 0 ? `Resend code in ${patientOtpCooldown}s` : "Resend code"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPatientOtpStep("EMAIL");
                          setPatientOtpCode("");
                          setPatientMessage("");
                          setPatientError("");
                        }}
                        className="h-11 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink"
                      >
                        Use a different email
                      </button>
                    </form>
                  )}

                  {patientError && (
                    <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{patientError}</p>
                  )}
                  {patientMessage && (
                    <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{patientMessage}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-moss">Patient portal</p>
                      <h2 className="text-2xl font-bold text-ink">Approved summaries</h2>
                      <p className="mt-1 break-all text-xs font-semibold text-ink/65">{patientSession.email}</p>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => logoutPatient().catch((logoutError) => setPatientError(logoutError.message))}
                      className="h-10 rounded-lg border border-mint bg-white px-3 text-sm font-semibold text-ink"
                    >
                      Logout
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-clinic p-1">
                    <button
                      type="button"
                      onClick={() => setPatientPortalTab("VISITS")}
                      className={`h-10 rounded-md text-sm font-bold ${
                        patientPortalTab === "VISITS" ? "bg-white text-moss shadow-soft" : "text-ink"
                      }`}
                    >
                      My Visits
                    </button>
                    <button
                      type="button"
                      onClick={() => setPatientPortalTab("PROGRESS")}
                      className={`h-10 rounded-md text-sm font-bold ${
                        patientPortalTab === "PROGRESS" ? "bg-white text-moss shadow-soft" : "text-ink"
                      }`}
                    >
                      My Progress
                    </button>
                  </div>

                  {patientError && (
                    <p className="rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{patientError}</p>
                  )}
                  {patientMessage && (
                    <p className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-ink">{patientMessage}</p>
                  )}

                  {isLoadingPatientPortal ? (
                    <p className="rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">Loading portal.</p>
                  ) : patientPortalTab === "VISITS" ? (
                    <div className="space-y-3">
                      {patientPortalVisits.length === 0 ? (
                        <p className="rounded-lg bg-clinic px-3 py-3 text-sm font-semibold text-ink">
                          No approved visits yet.
                        </p>
                      ) : (
                        patientPortalVisits.map((visit) => {
                          const followUp = extractSummarySection(visit.approvedSummary, "Follow-up / instructions");
                          return (
                            <div key={visit.id} className="rounded-lg border border-mint bg-clinic p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-bold text-ink">{formatTimestamp(visit.approvedAt || visit.createdAt)}</p>
                                  <p className="mt-1 text-xs font-semibold text-ink/65">
                                    {visit.doctor.name} - {visit.doctor.email}
                                  </p>
                                </div>
                                <StatusChip status="APPROVED" />
                              </div>
                              <div className="mt-3">
                                <p className="text-xs font-bold uppercase text-moss">Approved summary</p>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                                  {visit.approvedSummary}
                                </p>
                              </div>
                              {followUp && (
                                <div className="mt-3 rounded-lg bg-white p-3">
                                  <p className="text-xs font-bold uppercase text-moss">Follow-up / instructions</p>
                                  <p className="mt-1 text-sm leading-relaxed text-ink/80">{followUp}</p>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {patientPortalProgress.length === 0 ? (
                        <p className="rounded-lg bg-clinic px-3 py-3 text-sm font-semibold text-ink">
                          My Progress appears after at least 2 approved visits with the same doctor.
                        </p>
                      ) : (
                        patientPortalProgress.map((progress) => (
                          <div key={progress.doctor.id} className="rounded-lg border border-mint bg-clinic p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-bold text-ink">{progress.doctor.name}</p>
                                <p className="mt-1 text-xs font-semibold text-ink/65">{progress.doctor.email}</p>
                                <p className="mt-1 text-xs font-semibold text-ink/65">
                                  {progress.approvedVisitCount} approved visits
                                </p>
                              </div>
                              <span className={`rounded-md px-2 py-1 text-xs font-bold ${trendTone(progress.trend)}`}>
                                {labelFromCode(progress.trend)}
                              </span>
                            </div>

                            {[
                              ["What changed since last visit", progress.keyChangesSinceLastVisit],
                              ["Unresolved concerns", progress.unresolvedIssues],
                              ["Follow-up reminders", progress.followUpProgress]
                            ].map(([title, items]) => (
                              <div key={title as string} className="mt-3">
                                <p className="text-xs font-bold uppercase text-moss">{title as string}</p>
                                <div className="mt-2 space-y-1">
                                  {(items as string[]).length > 0 ? (
                                    (items as string[]).map((item) => (
                                      <p key={item} className="rounded-lg bg-white px-3 py-2 text-sm leading-relaxed text-ink/80">
                                        {item}
                                      </p>
                                    ))
                                  ) : (
                                    <p className="rounded-lg bg-white px-3 py-2 text-sm leading-relaxed text-ink/70">
                                      Not clearly documented in approved summaries.
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => loadPatientPortalData().catch((portalError) => setPatientError(portalError.message))}
                    className="h-10 w-full rounded-lg border border-mint bg-white text-sm font-bold text-ink"
                  >
                    Refresh
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-mint pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-moss text-white">
            <Stethoscope size={23} aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-moss">DoctorAI</p>
            <h1 className="text-xl font-bold text-ink">{dashboardTitle}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-ink">
            {isOnline ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
            {isOnline ? "Online" : "Offline"}
          </span>
          <button
            className="h-10 rounded-lg border border-mint bg-white px-3 text-sm font-semibold text-ink"
            onClick={async () => {
              window.localStorage.removeItem("doctorai.doctor");
              await stopAzureRecognizer();
              setDoctor(null);
              setVisits([]);
              setActiveVisit(null);
              setShowUsage(false);
              setUsageEvents([]);
              setNotice("");
              setError("");
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white p-3 shadow-soft">
          <p className="text-xs font-bold uppercase text-moss">Interrupted</p>
          <p className="mt-1 text-xl font-bold text-ink">{dashboardStats.interrupted}</p>
        </div>
        <div className="rounded-lg bg-white p-3 shadow-soft">
          <p className="text-xs font-bold uppercase text-moss">Summarized</p>
          <p className="mt-1 text-xl font-bold text-ink">{dashboardStats.summarized}</p>
        </div>
        <div className="rounded-lg bg-white p-3 shadow-soft">
          <p className="text-xs font-bold uppercase text-moss">Emailed</p>
          <p className="mt-1 text-xl font-bold text-ink">{dashboardStats.emailed}</p>
        </div>
      </div>

      {(notice || error) && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm font-semibold ${
            error ? "bg-coral text-white" : "bg-mint text-ink"
          }`}
        >
          {error || notice}
        </div>
      )}

      <section className="grid gap-5 py-5 lg:grid-cols-[330px_1fr]">
        <aside className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-moss">{doctor.name}</p>
              <h2 className="text-2xl font-bold text-ink">Dashboard</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {canViewUsage && (
                <button
                  onClick={() => {
                    setShowUsage((current) => {
                      const next = !current;
                      if (next) loadUsage().catch((usageError) => setError(usageError.message));
                      return next;
                    });
                  }}
                  className="flex h-11 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-sm font-bold text-ink"
                >
                  <BarChart3 size={18} aria-hidden="true" />
                  Usage
                </button>
              )}
              <button
                onClick={() => setShowNewVisit((current) => !current)}
                className="flex h-11 items-center gap-2 rounded-lg bg-moss px-4 text-sm font-bold text-white"
              >
                <Plus size={18} aria-hidden="true" />
                New Visit
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-white p-4 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-moss">Email settings</p>
                <p className="mt-1 break-all text-xs text-ink/65">
                  Send a test email only to {doctor.email}.
                </p>
              </div>
              <button
                type="button"
                disabled={isSendingTestEmail}
                onClick={() => sendTestEmailToSelf().catch((testEmailError) => setError(testEmailError.message))}
                className="flex h-10 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-xs font-bold text-ink disabled:opacity-60"
              >
                <Mail size={15} aria-hidden="true" />
                {isSendingTestEmail ? "Sending" : "Send test"}
              </button>
            </div>
            {testEmailMessage && (
              <p className="mt-3 rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">
                {testEmailMessage}
              </p>
            )}
          </div>

          {showNewVisit && (
            <form onSubmit={createVisit} className="rounded-lg bg-white p-4 shadow-soft">
              <h3 className="text-base font-bold text-ink">New visit</h3>
              <div className="mt-4 grid gap-3">
                <input
                  required
                  placeholder="Patient name"
                  value={visitForm.patientName}
                  onChange={(event) => setVisitForm({ ...visitForm, patientName: event.target.value })}
                  className="h-11 rounded-lg border border-mint px-3 outline-none focus:border-moss"
                />
                <input
                  required
                  min="0"
                  placeholder="Age"
                  type="number"
                  value={visitForm.patientAge}
                  onChange={(event) => setVisitForm({ ...visitForm, patientAge: event.target.value })}
                  className="h-11 rounded-lg border border-mint px-3 outline-none focus:border-moss"
                />
                <input
                  required
                  placeholder="Patient email"
                  type="email"
                  value={visitForm.patientEmail}
                  onChange={(event) => setVisitForm({ ...visitForm, patientEmail: event.target.value })}
                  className="h-11 rounded-lg border border-mint px-3 outline-none focus:border-moss"
                />
                <input
                  placeholder="Phone"
                  value={visitForm.patientPhone}
                  onChange={(event) => setVisitForm({ ...visitForm, patientPhone: event.target.value })}
                  className="h-11 rounded-lg border border-mint px-3 outline-none focus:border-moss"
                />
              </div>

              <div className="mt-3">
                <PatientHistoryBanner
                  history={newVisitHistory}
                  isLoading={isLoadingNewVisitHistory}
                  error={newVisitHistoryError}
                  onOpen={() => setIsNewVisitHistoryOpen(true)}
                />
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="mb-2 text-sm font-bold text-ink">Recording consent</p>
                  <div className="grid grid-cols-3 gap-2">
                    {CONSENT_STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() =>
                          setVisitForm({
                            ...visitForm,
                            consentStatus: status,
                            inputModeRequested:
                              status === "GRANTED" ? visitForm.inputModeRequested : "DOCTOR_SELF_SUMMARY"
                          })
                        }
                        className={`h-10 rounded-lg border text-xs font-bold ${
                          visitForm.consentStatus === status
                            ? "border-moss bg-moss text-white"
                            : "border-mint bg-white text-ink"
                        }`}
                      >
                        {labelFromCode(status)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-bold text-ink">Requested mode</p>
                  <div className="grid grid-cols-2 gap-2">
                    {INPUT_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={mode === "LIVE_CONVERSATION" && visitForm.consentStatus !== "GRANTED"}
                        onClick={() => setVisitForm({ ...visitForm, inputModeRequested: mode })}
                        className={`h-10 rounded-lg border text-xs font-bold ${
                          visitForm.inputModeRequested === mode
                            ? "border-moss bg-mint text-ink"
                            : "border-mint bg-white text-ink"
                        }`}
                      >
                        {labelFromCode(mode)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                disabled={isBusy}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-moss text-sm font-semibold text-white"
              >
                <ClipboardList size={17} aria-hidden="true" />
                Create draft visit
              </button>
            </form>
          )}

          {showUsage && canViewUsage && (
            <div className="rounded-lg bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-moss">Internal usage</p>
                  <p className="text-xs text-ink/65">Operational events only, no cost data.</p>
                </div>
                <button
                  onClick={() => loadUsage().catch((usageError) => setError(usageError.message))}
                  className="flex h-9 items-center gap-2 rounded-lg border border-mint px-3 text-xs font-bold text-ink"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {isLoadingUsage ? (
                  <p className="rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">Loading usage events.</p>
                ) : usageEvents.length === 0 ? (
                  <p className="rounded-lg bg-clinic px-3 py-2 text-sm font-semibold text-ink">No usage events yet.</p>
                ) : (
                  usageEvents.map((event) => (
                    <div key={event.id} className="rounded-lg border border-mint bg-clinic p-3">
                      <p className="text-xs font-bold uppercase text-moss">{labelFromCode(event.type)}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {event.visit?.patient.name || event.doctor?.name || "DoctorAI"}
                      </p>
                      <p className="text-xs text-ink/65">{formatTimestamp(event.createdAt)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {visits.length === 0 ? (
              <div className="rounded-lg bg-white p-6 text-center shadow-soft">
                <ClipboardList className="mx-auto text-moss" size={32} aria-hidden="true" />
                <p className="mt-3 font-bold text-ink">No visits yet</p>
              </div>
            ) : (
              visits.map((visit) => (
                <button
                  key={visit.id}
                  onClick={() => selectVisit(visit)}
                  className={`w-full rounded-lg border bg-white p-4 text-left shadow-soft ${
                    activeVisit?.id === visit.id ? "border-moss" : "border-transparent"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-ink">{visit.patient.name}</h3>
                      <p className="text-sm text-ink/70">
                        Age {visit.patient.age} - {visit.patient.email}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {buildVisitChips(visit, activeVisit?.id === visit.id && isRecording).map((status) => (
                        <StatusChip key={status} status={status} />
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-1 text-sm text-ink/75">
                    <p>Consent: {labelFromCode(visit.consentStatus)}</p>
                    <p>Actual: {labelFromCode(visit.inputModeActual)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-h-[640px] rounded-lg bg-white p-4 shadow-soft sm:p-5">
          {!activeVisit ? (
            <div className="flex min-h-[560px] items-center justify-center text-center">
              <div>
                <ClipboardList className="mx-auto text-moss" size={36} aria-hidden="true" />
                <p className="mt-3 text-lg font-bold text-ink">Create or select a visit</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mint pb-4">
                <div>
                  <p className="text-sm font-semibold text-moss">
                    {activeVisit.patient.name}, {activeVisit.patient.age}
                  </p>
                  <h2 className="text-2xl font-bold text-ink">{labelFromCode(activeVisit.status)}</h2>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {buildVisitChips(activeVisit, isRecording).map((status) => (
                      <StatusChip key={status} status={status} />
                    ))}
                  </div>
                  <p className="mt-1 text-sm text-ink/70">
                    Consent: {labelFromCode(activeVisit.consentStatus)} - Resume count: {activeVisit.resumeCount}
                  </p>
                </div>
                <span className="flex h-10 items-center gap-2 rounded-lg bg-clinic px-3 text-sm font-bold text-ink">
                  <Save size={16} aria-hidden="true" />
                  {isSaving ? "Saving" : lastSavedAt ? `Saved ${lastSavedAt}` : "Autosave ready"}
                </span>
              </div>

              <PatientHistoryPanel
                history={activeVisitHistory}
                isLoading={isLoadingActiveVisitHistory}
                error={activeVisitHistoryError}
                tab={activeVisitHistoryTab}
                onTabChange={setActiveVisitHistoryTab}
              />

              {activeVisit.status === "INTERRUPTED" && (
                <div className="rounded-lg border border-amberline bg-clinic p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 text-amberline" size={19} aria-hidden="true" />
                    <div>
                      <p className="font-bold text-ink">Visit interrupted</p>
                      <p className="text-sm text-ink/75">
                        Reason: {labelFromCode(activeVisit.interruptionReason || "risk_event")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={!microphoneAllowed || isBusy || visitLocked}
                      onClick={() => resumeRecording().catch((resumeError) => setError(resumeError.message))}
                      className="flex h-10 items-center gap-2 rounded-lg bg-amberline px-3 text-sm font-bold text-ink"
                    >
                      <RotateCcw size={17} aria-hidden="true" />
                      Resume
                    </button>
                    <button
                      onClick={() => switchToSelfSummary().catch((modeError) => setError(modeError.message))}
                      className="flex h-10 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-sm font-bold text-ink"
                    >
                      <ClipboardCheck size={17} aria-hidden="true" />
                      Doctor Self-Summary
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 rounded-lg bg-clinic p-1">
                <button
                  type="button"
                  disabled={!liveAllowed || visitLocked}
                  onClick={() => switchToLive().catch((modeError) => setError(modeError.message))}
                  className={`flex h-11 items-center justify-center gap-2 rounded-md text-sm font-bold ${
                    activeMode === "LIVE_CONVERSATION" ? "bg-white text-moss shadow-soft" : "text-ink"
                  }`}
                >
                  <Mic size={17} aria-hidden="true" />
                  Live Conversation
                </button>
                <button
                  type="button"
                  disabled={visitLocked}
                  onClick={() => switchToSelfSummary().catch((modeError) => setError(modeError.message))}
                  className={`flex h-11 items-center justify-center gap-2 rounded-md text-sm font-bold ${
                    activeMode === "DOCTOR_SELF_SUMMARY" ? "bg-white text-moss shadow-soft" : "text-ink"
                  }`}
                >
                  <ClipboardCheck size={17} aria-hidden="true" />
                  Doctor Self-Summary
                </button>
              </div>

              <div className="rounded-lg border border-mint bg-clinic p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink">Azure Speech transcription</p>
                    <p className="text-sm text-ink/75">
                      Start requests a short-lived Speech token, then browser microphone permission.
                    </p>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-moss">
                    {labelFromCode(micState)}
                  </span>
                </div>
                {micError && <p className="mt-3 rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white">{micError}</p>}
                {interimText && (
                  <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-ink">
                    Listening: {interimText}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    disabled={!microphoneAllowed || isRecording || isBusy || visitLocked}
                    onClick={() => startRecording().catch((recordingError) => setError(recordingError.message))}
                    className="flex h-10 items-center gap-2 rounded-lg bg-moss px-3 text-sm font-bold text-white"
                  >
                    <Play size={17} aria-hidden="true" />
                    Start
                  </button>
                  <button
                    disabled={!isRecording || isBusy}
                    onClick={() => pauseRecording().catch((pauseError) => setError(pauseError.message))}
                    className="flex h-10 items-center gap-2 rounded-lg bg-coral px-3 text-sm font-bold text-white"
                  >
                    <Pause size={17} aria-hidden="true" />
                    Stop
                  </button>
                  <button
                    disabled={isRecording || !microphoneAllowed || isBusy || visitLocked}
                    onClick={() => resumeRecording().catch((resumeError) => setError(resumeError.message))}
                    className="flex h-10 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-sm font-bold text-ink"
                  >
                    <RotateCcw size={17} aria-hidden="true" />
                    Retry/Resume
                  </button>
                </div>
              </div>

              <label className="block text-sm font-bold text-ink">
                {activeMode === "LIVE_CONVERSATION" ? "Live conversation transcript" : "Doctor self-summary"}
                <textarea
                  value={transcript}
                  disabled={Boolean(activeVisit.approvedSummary)}
                  onChange={(event) => {
                    setTranscript(event.target.value);
                    transcriptRef.current = event.target.value;
                    dirtyRef.current = true;
                  }}
                  className="mt-2 min-h-[300px] w-full resize-y rounded-lg border border-mint bg-clinic p-3 leading-relaxed outline-none focus:border-moss"
                  placeholder={
                    activeMode === "LIVE_CONVERSATION"
                      ? "Azure Speech transcript appears here while recording."
                      : "Type or dictate the doctor's self-summary here."
                  }
                />
              </label>

              <div className="rounded-lg border border-mint bg-clinic p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink">Summary review</p>
                    <p className="text-sm text-ink/75">
                      Draft generations: {activeVisit.draftGenerationCount}
                    </p>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-xs font-bold ${chipTone(activeVisit.status)}`}>
                    {labelFromCode(summaryState === "generating" ? "SUMMARIZING" : activeVisit.status)}
                  </span>
                </div>

                {summaryMessage && (
                  <p
                    className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${
                      summaryState === "error" ? "bg-coral text-white" : "bg-white text-ink"
                    }`}
                  >
                    {summaryMessage}
                  </p>
                )}
                {emailMessage && (
                  <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-ink">{emailMessage}</p>
                )}

                <label className="mt-3 block text-sm font-bold text-ink">
                  Draft summary
                  <textarea
                    value={approvedSummaryDraft}
                    disabled={Boolean(activeVisit.approvedSummary)}
                    onChange={(event) => setApprovedSummaryDraft(event.target.value)}
                    className="mt-2 min-h-[220px] w-full resize-y rounded-lg border border-mint bg-white p-3 leading-relaxed outline-none focus:border-moss"
                    placeholder="Stop recording or save text, then generate a draft summary."
                  />
                </label>

                {activeVisit.approvedSummary && (
                  <div className="mt-3 rounded-lg border border-mint bg-white p-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-moss">
                      <CheckCircle2 size={17} aria-hidden="true" />
                      Approved final summary
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {activeVisit.approvedSummary}
                    </p>
                  </div>
                )}

                <div className="mt-3 rounded-lg border border-mint bg-white p-3">
                  <p className="text-sm font-bold text-ink">Email delivery consent</p>
                  <p className="mt-1 text-xs font-semibold text-ink/65">
                    This controls secure summary link email only. The summary can be approved without email consent.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {([
                      ["NOT_ASKED", "Not asked"],
                      ["APPROVED", "Approved"],
                      ["DECLINED", "Declined"]
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={Boolean(activeVisit.emailedAt)}
                        onClick={() => setUnencryptedEmailConsentStatus(value)}
                        className={`h-10 rounded-lg border text-xs font-bold ${
                          unencryptedEmailConsentStatus === value
                            ? "border-moss bg-mint text-ink"
                            : "border-mint bg-white text-ink"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {unencryptedEmailConsentStatus !== "APPROVED" && !activeVisit.emailedAt && (
                    <p className="mt-2 text-xs font-semibold text-coral">
                      Send Secure Link is unavailable until email consent is approved.
                    </p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    disabled={
                      isRecording ||
                      isBusy ||
                      summaryState === "generating" ||
                      Boolean(activeVisit.approvedSummary)
                    }
                    onClick={() => generateSummary().catch((summaryError) => setError(summaryError.message))}
                    className="flex h-10 items-center gap-2 rounded-lg bg-moss px-3 text-sm font-bold text-white"
                  >
                    <Sparkles size={17} aria-hidden="true" />
                    {draftSummary ? "Regenerate Summary" : "Generate Summary"}
                  </button>
                  <button
                    disabled={
                      isRecording ||
                      isBusy ||
                      summaryState === "generating" ||
                      summaryState === "approving" ||
                      Boolean(activeVisit.approvedSummary) ||
                      !approvedSummaryDraft.trim()
                    }
                    onClick={() => approveSummary().catch((approvalError) => setError(approvalError.message))}
                    className="flex h-10 items-center gap-2 rounded-lg bg-coral px-3 text-sm font-bold text-white"
                  >
                    <CheckCircle2 size={17} aria-hidden="true" />
                    Approve Summary
                  </button>
                  <button
                    disabled={
                      isRecording ||
                      isBusy ||
                      !activeVisit.approvedSummary ||
                      Boolean(activeVisit.emailedAt) ||
                      unencryptedEmailConsentStatus !== "APPROVED"
                    }
                    onClick={() => sendEmail().catch((emailError) => setError(emailError.message))}
                    className="flex h-10 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-sm font-bold text-ink"
                  >
                    <Mail size={17} aria-hidden="true" />
                    Send Secure Link
                  </button>
                  <span className="flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-moss">
                    <FileText size={16} aria-hidden="true" />
                    {activeVisit.emailedAt
                      ? `Emailed ${formatTimestamp(activeVisit.emailedAt)}`
                      : activeVisit.approvedAt
                        ? `Approved ${formatTimestamp(activeVisit.approvedAt)}`
                        : "Draft only"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  disabled={isBusy || Boolean(activeVisit.approvedSummary)}
                  onClick={() =>
                    saveTranscript(
                      activeMode === "DOCTOR_SELF_SUMMARY" && !isRecording ? "READY_FOR_DOCUMENTATION" : activeVisit.status,
                      activeMode
                    ).catch((saveError) => setError(saveError.message))
                  }
                  className="flex h-11 items-center gap-2 rounded-lg bg-moss px-4 text-sm font-bold text-white"
                >
                  <Save size={17} aria-hidden="true" />
                  Save Draft
                </button>
                <span className="flex h-11 items-center rounded-lg bg-clinic px-3 text-sm font-bold text-moss">
                  Saved automatically every 4 seconds
                </span>
              </div>
            </div>
          )}
        </section>
      </section>
      <PatientHistoryModal
        isOpen={isNewVisitHistoryOpen}
        onClose={() => setIsNewVisitHistoryOpen(false)}
        patientEmail={visitForm.patientEmail.trim().toLowerCase()}
        history={newVisitHistory}
        isLoading={isLoadingNewVisitHistory}
        error={newVisitHistoryError}
        tab={newVisitHistoryTab}
        onTabChange={setNewVisitHistoryTab}
      />
    </main>
  );
}
