"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
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
  WifiOff
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONSENT_STATUSES, INPUT_MODES, labelFromCode, type ConsentStatus, type InputMode } from "@/lib/status";
import type { EmailDeliveryLog, UsageEvent, VisitWithPatient } from "@/lib/types";

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
};

type EmailResponse = {
  visit: VisitWithPatient;
  emailDeliveryLog: EmailDeliveryLog;
  emailSimulated?: boolean;
  emailError?: string;
};

type RuntimeConfigResponse = {
  demoLogin: {
    enabled: boolean;
    email?: string;
    password?: string;
  };
};

type EmailConsentStatus = "APPROVED" | "DECLINED" | "NOT_ASKED";

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
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
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
  const [unencryptedEmailConsentStatus, setUnencryptedEmailConsentStatus] =
    useState<EmailConsentStatus>("NOT_ASKED");
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [showUsage, setShowUsage] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
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
    setAuthForm({
      name: "",
      email: runtimeConfig.demoLogin.email,
      password: runtimeConfig.demoLogin.password
    });
    setError("");
    setNotice("Demo credentials filled.");
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
      setDoctor(result.doctor);
      window.localStorage.setItem("doctorai.doctor", JSON.stringify(result.doctor));
      const nextVisits = await loadVisits(result.doctor.id);
      if (nextVisits[0]) await selectVisit(nextVisits[0]);
      setNotice(authMode === "signup" ? "Account created." : "Welcome back.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
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
      setEmailMessage(
        result.visit.emailedAt
          ? `Final summary already emailed ${formatTimestamp(result.visit.emailedAt)}.`
          : "Summary approved. Email can be sent only if patient email consent is approved."
      );
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
            : "Approved summary sent to the patient email.")
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
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-8">
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
            {(["signup", "login"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAuthMode(mode);
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
            <label className="block text-sm font-semibold text-ink">
              Password
              <input
                required
                minLength={6}
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                className="mt-2 h-12 w-full rounded-lg border border-mint bg-white px-3 outline-none focus:border-moss"
              />
            </label>
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
                    This controls email sending only. The summary can be approved without email consent.
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
                      Send Email is unavailable until email consent is approved.
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
                    Send Email
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
    </main>
  );
}
