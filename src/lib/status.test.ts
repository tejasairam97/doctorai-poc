import { describe, expect, it } from "vitest";
import { actualModeForConsent, labelFromCode } from "./status";

describe("status helpers", () => {
  it("keeps the requested mode when recording consent is granted", () => {
    expect(actualModeForConsent("GRANTED", "LIVE_CONVERSATION")).toBe("LIVE_CONVERSATION");
    expect(actualModeForConsent("GRANTED", "DOCTOR_SELF_SUMMARY")).toBe("DOCTOR_SELF_SUMMARY");
  });

  it("falls back to doctor self-summary when recording consent is missing or denied", () => {
    expect(actualModeForConsent("DENIED", "LIVE_CONVERSATION")).toBe("DOCTOR_SELF_SUMMARY");
    expect(actualModeForConsent("UNKNOWN", "LIVE_CONVERSATION")).toBe("DOCTOR_SELF_SUMMARY");
  });

  it("turns status codes into readable labels", () => {
    expect(labelFromCode("READY_FOR_DOCUMENTATION")).toBe("Ready For Documentation");
    expect(labelFromCode("EMAIL_FAILED")).toBe("Email Failed");
  });
});
