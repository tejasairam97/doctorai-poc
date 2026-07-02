import { createHash, createHmac } from "crypto";
import { getAcsEmailEnv } from "./server-config";

type EmailSendResult = {
  status: "SENT" | "SIMULATED";
  providerId?: string;
};

type ParsedAcsConnectionString = {
  endpoint: string;
  accessKey: string;
};

function parseAcsConnectionString(connectionString: string): ParsedAcsConnectionString {
  const parts = Object.fromEntries(
    connectionString
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        return [part.slice(0, separatorIndex).toLowerCase(), part.slice(separatorIndex + 1)];
      })
  );

  const endpoint = parts.endpoint;
  const accessKey = parts.accesskey;
  if (!endpoint || !accessKey) {
    throw new Error("ACS_CONNECTION_STRING must include endpoint and accesskey.");
  }

  return { endpoint, accessKey };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createAcsAuthorization(input: {
  method: string;
  url: URL;
  body: string;
  accessKey: string;
  date: string;
}) {
  const contentHash = createHash("sha256").update(input.body).digest("base64");
  const pathAndQuery = `${input.url.pathname}${input.url.search}`;
  const stringToSign = `${input.method}\n${pathAndQuery}\n${input.date};${input.url.host};${contentHash}`;
  const signature = createHmac("sha256", Buffer.from(input.accessKey, "base64"))
    .update(stringToSign)
    .digest("base64");

  return {
    contentHash,
    authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`
  };
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
  if (!env.connectionString || !env.senderAddress) {
    return {
      status: "SIMULATED",
      providerId: `local-simulated-${Date.now()}`
    };
  }

  const { endpoint, accessKey } = parseAcsConnectionString(env.connectionString);
  const url = new URL("/emails:send?api-version=2023-03-31", endpoint);
  const body = JSON.stringify({
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
  const date = new Date().toUTCString();
  const { authorization, contentHash } = createAcsAuthorization({
    method: "POST",
    url,
    body,
    accessKey,
    date
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "Content-Type": "application/json",
      "x-ms-content-sha256": contentHash,
      "x-ms-date": date
    },
    body
  });

  const providerId =
    response.headers.get("operation-location") ||
    response.headers.get("x-ms-request-id") ||
    undefined;

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`ACS Email send failed (${response.status}). ${details.slice(0, 240)}`.trim());
  }

  return {
    status: "SENT",
    providerId
  };
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
  expiresInMinutes: number;
}): Promise<EmailSendResult> {
  const audience = input.roleContext === "patient" ? "patient portal" : "DoctorAI";
  const plainText = [
    "Your DoctorAI verification code is:",
    "",
    input.code,
    "",
    `This code expires in ${input.expiresInMinutes} minutes.`,
    `Use it only to finish signing in to ${audience}.`,
    "If you did not request this code, you can ignore this email."
  ].join("\n");
  const html = `
    <p>Your DoctorAI verification code is:</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(input.code)}</p>
    <p>This code expires in ${input.expiresInMinutes} minutes.</p>
    <p>Use it only to finish signing in to ${escapeHtml(audience)}.</p>
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
