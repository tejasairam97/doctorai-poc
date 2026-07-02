import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { getAuthSecret } from "./server-config";

export type OtpRoleContext = "patient" | "doctor";
export type OtpPurpose = "login" | "patient_portal";

export const OTP_EXPIRES_IN_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_EMAIL_COOLDOWN_SECONDS = 60;
export const OTP_RATE_LIMIT_WINDOW_MINUTES = 15;
export const OTP_MAX_EMAIL_REQUESTS_PER_WINDOW = 5;
export const OTP_MAX_IP_REQUESTS_PER_WINDOW = 20;
export const PATIENT_SESSION_COOKIE_NAME = "doctorai_patient_session";
export const PATIENT_SESSION_EXPIRES_IN_DAYS = 30;
export const PATIENT_SESSION_EXPIRES_IN_SECONDS = PATIENT_SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60;
export const PATIENT_SUMMARY_LINK_EXPIRES_IN_DAYS = 30;

export function normalizeOtpEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidOtpEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isOtpRoleContext(value: unknown): value is OtpRoleContext {
  return value === "patient" || value === "doctor";
}

export function purposeForRoleContext(roleContext: OtpRoleContext): OtpPurpose {
  return roleContext === "patient" ? "patient_portal" : "login";
}

export function generateOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hmacHex(value: string) {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}

export function hashOtpCode(input: {
  email: string;
  roleContext: OtpRoleContext;
  purpose: OtpPurpose;
  code: string;
}) {
  return hmacHex(
    [
      "doctorai-otp-v1",
      normalizeOtpEmail(input.email),
      input.roleContext,
      input.purpose,
      input.code.trim()
    ].join(":")
  );
}

export function verifyHash(candidateHash: string, storedHash: string) {
  const candidate = Buffer.from(candidateHash, "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function generatePatientSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPatientSessionToken(token: string) {
  return hmacHex(["doctorai-patient-session-v1", token].join(":"));
}

export function generatePatientSummaryLinkToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPatientSummaryLinkToken(token: string) {
  return hmacHex(["doctorai-patient-summary-link-v1", token].join(":"));
}
