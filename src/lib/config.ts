import { z } from "zod";
import type { AppConfig } from "./domain/types";

const booleanValue = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const integerValue = (defaultValue: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(defaultValue);

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/, "Use 16–256 letters, digits, _ or -"),
  TELEGRAM_ADMIN_IDS: z.string().default(""),
  VIDEO_PROVIDER: z.enum(["runway", "kling"]).default("runway"),
  RUNWAYML_API_SECRET: z.string().default(""),
  KLING_API_KEY: z.string().default(""),
  DATABASE_URL: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().default(""),
  CRON_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DAILY_GENERATION_LIMIT: integerValue(5, 1, 1000),
  MAX_CONCURRENT_GENERATIONS: integerValue(2, 1, 100),
  GENERATIONS_ENABLED: booleanValue("true"),
  USE_MOCK_RUNWAY: booleanValue("false"),
  RATE_LIMIT_REQUESTS: integerValue(20, 1, 1000),
  RATE_LIMIT_WINDOW_SECONDS: integerValue(60, 1, 3600),
  MAX_IMAGE_BYTES: integerValue(10_485_760, 1024, 16_777_216),
  MAX_VIDEO_BYTES: integerValue(51_380_224, 1024, 52_428_800),
  SOURCE_TTL_HOURS: integerValue(24, 1, 168),
  MAX_SUBMISSION_ATTEMPTS: integerValue(3, 1, 10),
  SUBMISSION_STALE_MINUTES: integerValue(15, 5, 1440),
  POLL_BATCH_SIZE: integerValue(20, 1, 100),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const value = schema.parse(env);
  const useMockRunway = value.USE_MOCK_RUNWAY;

  if (value.NODE_ENV === "production" && useMockRunway) {
    throw new Error("USE_MOCK_RUNWAY is disabled when NODE_ENV=production.");
  }
  if (!useMockRunway && value.VIDEO_PROVIDER === "runway" && !value.RUNWAYML_API_SECRET) {
    throw new Error("RUNWAYML_API_SECRET is required when Runway MOCK mode is off.");
  }
  if (!useMockRunway && value.VIDEO_PROVIDER === "kling" && !value.KLING_API_KEY) {
    throw new Error("KLING_API_KEY is required when VIDEO_PROVIDER=kling and MOCK mode is off.");
  }
  if (value.NODE_ENV === "production" && !value.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required in production.");
  }

  return {
    nodeEnv: value.NODE_ENV,
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: value.TELEGRAM_WEBHOOK_SECRET,
    telegramAdminIds: new Set(
      value.TELEGRAM_ADMIN_IDS.split(",")
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
    videoProvider: value.VIDEO_PROVIDER,
    runwayApiKey: value.RUNWAYML_API_SECRET || null,
    klingApiKey: value.KLING_API_KEY || null,
    databaseUrl: value.DATABASE_URL,
    blobToken: value.BLOB_READ_WRITE_TOKEN || null,
    cronSecret: value.CRON_SECRET,
    appBaseUrl: value.APP_BASE_URL.replace(/\/$/, ""),
    dailyGenerationLimit: value.DAILY_GENERATION_LIMIT,
    maxConcurrentGenerations: value.MAX_CONCURRENT_GENERATIONS,
    generationsEnabled: value.GENERATIONS_ENABLED,
    useMockRunway,
    rateLimitRequests: value.RATE_LIMIT_REQUESTS,
    rateLimitWindowSeconds: value.RATE_LIMIT_WINDOW_SECONDS,
    maxImageBytes: value.MAX_IMAGE_BYTES,
    maxVideoBytes: value.MAX_VIDEO_BYTES,
    sourceTtlHours: value.SOURCE_TTL_HOURS,
    maxSubmissionAttempts: value.MAX_SUBMISSION_ATTEMPTS,
    submissionStaleMinutes: value.SUBMISSION_STALE_MINUTES,
    pollBatchSize: value.POLL_BATCH_SIZE,
  };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}
