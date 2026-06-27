export const CONSENT_STATUSES = ["GRANTED", "DENIED", "UNKNOWN"] as const;
export const INPUT_MODES = ["LIVE_CONVERSATION", "DOCTOR_SELF_SUMMARY"] as const;
export const VISIT_STATUSES = [
  "DRAFT",
  "RECORDING",
  "PAUSED",
  "INTERRUPTED",
  "TRANSCRIBED",
  "READY_FOR_DOCUMENTATION",
  "SUMMARIZED",
  "APPROVED",
  "EMAIL_FAILED",
  "EMAILED",
  "CLOSED"
] as const;

export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export type InputMode = (typeof INPUT_MODES)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export function actualModeForConsent(consentStatus: ConsentStatus, requestedMode: InputMode): InputMode {
  return consentStatus === "GRANTED" ? requestedMode : "DOCTOR_SELF_SUMMARY";
}

export function labelFromCode(code: string) {
  return code
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
