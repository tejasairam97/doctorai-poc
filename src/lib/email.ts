import { EmailClient } from "@azure/communication-email";
import { getAcsEmailEnv } from "./server-config";

type EmailSendResult = {
  status: "SENT" | "SIMULATED";
  provider: "ACS_EMAIL" | "LOCAL_SIMULATED";
  providerStatus: string;
  messageId?: string;
  providerId?: string;
};

function sanitizeEmailError(error: unknown) {
  const parts = [
    typeof error === "object" && error && "code" in error ? `code=${String(error.code)}` : "",
    typeof error === "object" && error && "statusCode" in error ? `status=${String(error.statusCode)}` : "",
    error instanceof Error ? `name=${error.name}` : "",
    error instanceof Error ? `message=${error.message}` : "message=Unknown ACS email error"
  ].filter(Boolean);

  return parts
    .join(" ")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]")
    .slice(0, 500);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getEmailConfigStatus() {
  const env = getAcsEmailEnv();
  return {
    configured: Boolean(env.connectionString && env.senderAddress),
    missing: {
      connectionString: !env.connectionString,
      senderAddress: !env.senderAddress
    }
  };
}

async function sendAcsEmail(input: {
  recipient: string;
  displayName: string;
  subject: string;
  plainText: string;
  html: string;
}): Promise<EmailSendResult> {
  const env = getAcsEmailEnv();
  const config = getEmailConfigStatus();

  console.info("[DoctorAI email config]", {
    acsConfigured: config.configured,
    senderConfigured: !config.missing.senderAddress,
    sendAttempted: Boolean(env.connectionString && env.senderAddress)
  });

  if (!env.connectionString || !env.senderAddress) {
    const simulatedId = `local-simulated-${Date.now()}`;
    return {
      status: "SIMULATED",
      provider: "LOCAL_SIMULATED",
      providerStatus: "SIMULATED",
      messageId: simulatedId,
      providerId: simulatedId
    };
  }

  try {
    const client = new EmailClient(env.connectionString);
    const poller = await client.beginSend({
      senderAddress: env.senderAddress,
      content: {
        subject: input.subject,
        plainText: input.plainText,
        html: input.html
      },
      recipients: {
        to: [{ address: input.recipient, displayName: input.displayName }]
      }
    });

    const result = await poller.pollUntilDone();
    const providerStatus = String(result?.status || "unknown");
    const messageId = result?.id;

    console.info("[DoctorAI email provider result]", {
      provider: "ACS_EMAIL",
      providerStatus,
      messageId: messageId ?? null
    });

    if (providerStatus.toLowerCase() !== "succeeded") {
      throw new Error(`ACS Email send finished with status ${providerStatus}.`);
    }

    return {
      status: "SENT",
      provider: "ACS_EMAIL",
      providerStatus,
      messageId,
      providerId: messageId
    };
  } catch (error) {
    const safeError = sanitizeEmailError(error);
    console.warn("[DoctorAI email provider failure]", {
      provider: "ACS_EMAIL",
      error: safeError
    });
    throw new Error(`ACS Email send failed. ${safeError}`);
  }
}

export async function sendApprovedSummaryEmail(input: {
  recipient: string;
  summaryUrl: string;
  expiresAt: Date;
}): Promise<EmailSendResult> {
  const expirationDate = input.expiresAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const plainText = [
    "Hello,",
    "",
    "Your DoctorAI visit summary is ready.",
    "For privacy, the summary is not included in this email.",
    "Open the secure link below and verify your email with a one-time code before viewing it:",
    "",
    input.summaryUrl,
    "",
    `This link expires on ${expirationDate}.`,
    "Please contact your clinician's office with questions."
  ].join("\n");
  const html = `
    <p>Hello,</p>
    <p>Your DoctorAI visit summary is ready.</p>
    <p>For privacy, the summary is not included in this email. Open the secure link below and verify your email with a one-time code before viewing it.</p>
    <p><a href="${escapeHtml(input.summaryUrl)}">Open your secure visit summary</a></p>
    <p>This link expires on ${escapeHtml(expirationDate)}.</p>
    <p>Please contact your clinician's office with questions.</p>
  `;

  return sendAcsEmail({
    recipient: input.recipient,
    displayName: "DoctorAI patient",
    subject: "Your DoctorAI visit summary is ready",
    plainText,
    html
  });
}

export async function sendDoctorTestEmail(input: {
  doctorName: string;
  recipient: string;
}): Promise<EmailSendResult> {
  const plainText = [
    `Hello ${input.doctorName},`,
    "",
    "This is a DoctorAI Azure Communication Services Email test.",
    "If you received this message, outbound email is configured for your DoctorAI environment.",
    "",
    "No patient information is included in this test email."
  ].join("\n");
  const html = `
    <p>Hello ${escapeHtml(input.doctorName)},</p>
    <p>This is a DoctorAI Azure Communication Services Email test.</p>
    <p>If you received this message, outbound email is configured for your DoctorAI environment.</p>
    <p><strong>No patient information is included in this test email.</strong></p>
  `;

  return sendAcsEmail({
    recipient: input.recipient,
    displayName: input.doctorName,
    subject: "DoctorAI email test",
    plainText,
    html
  });
}

export async function sendOtpEmail(input: {
  recipient: string;
  code: string;
  roleContext: "patient" | "doctor";
  purpose?: "login" | "patient_portal" | "password_reset";
  expiresInMinutes: number;
}): Promise<EmailSendResult> {
  const audience = input.roleContext === "patient" ? "patient portal" : "DoctorAI";
  const action =
    input.purpose === "password_reset"
      ? "resetting your DoctorAI password"
      : `finishing sign-in to ${audience}`;
  const plainText = [
    "Your DoctorAI verification code is:",
    "",
    input.code,
    "",
    `This code expires in ${input.expiresInMinutes} minutes.`,
    `Use it only for ${action}.`,
    "If you did not request this code, you can ignore this email."
  ].join("\n");
  const html = `
    <p>Your DoctorAI verification code is:</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(input.code)}</p>
    <p>This code expires in ${input.expiresInMinutes} minutes.</p>
    <p>Use it only for ${escapeHtml(action)}.</p>
    <p>If you did not request this code, you can ignore this email.</p>
  `;

  return sendAcsEmail({
    recipient: input.recipient,
    displayName: "DoctorAI user",
    subject: "Your DoctorAI verification code",
    plainText,
    html
  });
}
