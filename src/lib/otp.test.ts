import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateOtpCode,
  hashOtpCode,
  hashPatientSessionToken,
  hashPatientSummaryLinkToken,
  isOtpRoleContext,
  isValidOtpEmail,
  normalizeOtpEmail,
  purposeForRoleContext,
  verifyHash
} from "./otp";

const originalAuthSecret = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret";
});

afterEach(() => {
  if (originalAuthSecret) {
    process.env.AUTH_SECRET = originalAuthSecret;
  } else {
    delete process.env.AUTH_SECRET;
  }
});

describe("OTP helpers", () => {
  it("normalizes and validates email addresses", () => {
    expect(normalizeOtpEmail(" Patient.Placeholder@Example.TEST ")).toBe("patient.placeholder@example.test");
    expect(isValidOtpEmail("patient.placeholder@example.test")).toBe(true);
    expect(isValidOtpEmail("not-an-email")).toBe(false);
  });

  it("maps role contexts to the right OTP purpose", () => {
    expect(isOtpRoleContext("patient")).toBe(true);
    expect(isOtpRoleContext("doctor")).toBe(true);
    expect(isOtpRoleContext("admin")).toBe(false);
    expect(purposeForRoleContext("patient")).toBe("patient_portal");
    expect(purposeForRoleContext("doctor")).toBe("login");
  });

  it("generates six digit codes", () => {
    expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("hashes OTP codes consistently across email casing and spacing", () => {
    const storedHash = hashOtpCode({
      email: "patient.placeholder@example.test",
      roleContext: "patient",
      purpose: "patient_portal",
      code: "123456"
    });
    const candidateHash = hashOtpCode({
      email: " Patient.Placeholder@Example.TEST ",
      roleContext: "patient",
      purpose: "patient_portal",
      code: " 123456 "
    });

    expect(candidateHash).toBe(storedHash);
    expect(verifyHash(candidateHash, storedHash)).toBe(true);
    expect(verifyHash(hashPatientSessionToken("session-token"), storedHash)).toBe(false);
  });

  it("separates patient session and summary link token hashes", () => {
    expect(hashPatientSessionToken("same-token")).not.toBe(hashPatientSummaryLinkToken("same-token"));
  });
});
