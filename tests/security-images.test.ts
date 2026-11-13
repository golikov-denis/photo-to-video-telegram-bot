import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { validateImage } from "@/lib/images";
import { isAuthorizedCron, isAuthorizedTelegramWebhook } from "@/lib/security";
import { JPEG_BYTES, testConfig } from "./helpers";

describe("endpoint security and input validation", () => {
  it("checks the Telegram webhook secret exactly", () => {
    expect(isAuthorizedTelegramWebhook("secret_123456789012", "secret_123456789012")).toBe(true);
    expect(isAuthorizedTelegramWebhook("wrong", "secret_123456789012")).toBe(false);
    expect(isAuthorizedTelegramWebhook(null, "secret_123456789012")).toBe(false);
  });

  it("requires a bearer cron secret", () => {
    expect(isAuthorizedCron("Bearer cron-secret-123", "cron-secret-123")).toBe(true);
    expect(isAuthorizedCron("cron-secret-123", "cron-secret-123")).toBe(false);
    expect(isAuthorizedCron("Bearer wrong", "cron-secret-123")).toBe(false);
    expect(isAuthorizedCron(null, "cron-secret-123")).toBe(false);
  });

  it("validates actual image signatures, not only MIME metadata", () => {
    expect(validateImage(JPEG_BYTES, 100).contentType).toBe("image/jpeg");
    expect(() => validateImage(Buffer.from([1, 2, 3, 4]), 100)).toThrow(
      "Поддерживаются только JPEG, PNG и WebP.",
    );
    expect(() => validateImage(JPEG_BYTES, 2)).toThrow("слишком большая");
  });

  it("does not allow MOCK mode in production", () => {
    const env = {
      ...process.env,
      NODE_ENV: "production" as const,
      USE_MOCK_RUNWAY: "true",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_WEBHOOK_SECRET: "webhook_secret_123456",
      DATABASE_URL: "postgresql://localhost/test",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      CRON_SECRET: "cron-secret-123456",
    };
    expect(() => loadConfig(env)).toThrow("USE_MOCK_RUNWAY");
  });

  it("uses MOCK mode only when explicitly enabled in tests", () => {
    expect(testConfig().useMockRunway).toBe(true);
    expect(testConfig({ USE_MOCK_RUNWAY: "false", RUNWAYML_API_SECRET: "key" }).useMockRunway).toBe(
      false,
    );
  });
});
