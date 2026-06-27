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

export async function sendApprovedSummaryEmail(input: {
  patientName: string;
  recipient: string;
  approvedSummary: string;
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
  const plainText = [
    `Hello ${input.patientName},`,
    "",
    "Your clinician has approved the following visit summary:",
    "",
    input.approvedSummary,
    "",
    "Please contact your clinician's office with questions."
  ].join("\n");
  const html = `
    <p>Hello ${escapeHtml(input.patientName)},</p>
    <p>Your clinician has approved the following visit summary:</p>
    <pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(input.approvedSummary)}</pre>
    <p>Please contact your clinician's office with questions.</p>
  `;
  const body = JSON.stringify({
    senderAddress: env.senderAddress,
    content: {
      subject: "Your visit summary",
      plainText,
      html
    },
    recipients: {
      to: [{ address: input.recipient, displayName: input.patientName }]
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
