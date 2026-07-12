import { afterEach, describe, expect, it } from "vitest";
import {
  getAcsEmailEnv,
  getAcsEndpointHost,
  getAppBaseUrl,
  getAuthSecret,
  isPlaceholderEnvValue,
  ServerConfigError,
  validateConfiguredServerEnv,
  validateServerEnv,
  type ServerEnvKey
} from "./server-config";

const TEST_ENV_KEYS: ServerEnvKey[] = [
  "DATABASE_URL",
  "APP_BASE_URL",
  "AUTH_SECRET",
  "ACS_CONNECTION_STRING",
  "COMMUNICATION_SERVICES_CONNECTION_STRING",
  "ACS_SENDER_ADDRESS"
];

function clearEnv() {
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(clearEnv);

describe("server configuration", () => {
  it("treats obvious placeholder values as unconfigured", () => {
    expect(isPlaceholderEnvValue("replace-with-your-auth-secret")).toBe(true);
    expect(isPlaceholderEnvValue("https://your-openai-resource.openai.azure.com")).toBe(true);
    expect(isPlaceholderEnvValue("postgresql://doctorai_user:doctorai_local_password@localhost:5432/doctorai")).toBe(false);
  });

  it("reports raw missing env vars separately from placeholder env vars", () => {
    clearEnv();
    process.env.DATABASE_URL = "postgresql://doctorai_user:doctorai_local_password@localhost:5432/doctorai";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.AUTH_SECRET = "replace-with-your-auth-secret";

    expect(validateServerEnv(["DATABASE_URL", "APP_BASE_URL", "AUTH_SECRET"])).toEqual({
      ok: true,
      missing: []
    });
    expect(validateConfiguredServerEnv(["DATABASE_URL", "APP_BASE_URL", "AUTH_SECRET"])).toMatchObject({
      ok: false,
      missing: ["AUTH_SECRET"]
    });
  });

  it("returns configured core values and throws a typed error when absent", () => {
    clearEnv();
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.AUTH_SECRET = "test-auth-secret";

    expect(getAppBaseUrl()).toBe("http://localhost:3000");
    expect(getAuthSecret()).toBe("test-auth-secret");

    delete process.env.AUTH_SECRET;
    expect(() => getAuthSecret()).toThrow(ServerConfigError);
  });

  it("accepts either ACS connection string variable and exposes its endpoint host", () => {
    clearEnv();
    process.env.COMMUNICATION_SERVICES_CONNECTION_STRING =
      "endpoint=https://doctorai-placeholder.communication.azure.com/;accesskey=test-key";
    process.env.ACS_SENDER_ADDRESS = "DoNotReply@doctorai.test";

    expect(getAcsEndpointHost(process.env.COMMUNICATION_SERVICES_CONNECTION_STRING)).toBe(
      "doctorai-placeholder.communication.azure.com"
    );
    expect(getAcsEmailEnv()).toMatchObject({
      connectionString: process.env.COMMUNICATION_SERVICES_CONNECTION_STRING,
      connectionStringSource: "COMMUNICATION_SERVICES_CONNECTION_STRING",
      endpointHost: "doctorai-placeholder.communication.azure.com",
      senderAddress: "DoNotReply@doctorai.test"
    });
  });
});
