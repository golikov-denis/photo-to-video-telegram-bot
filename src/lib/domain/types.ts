export const GENERATION_STATUSES = [
  "DRAFT",
  "WAITING_FOR_PROMPT",
  "CONFIRMED",
  "UPLOADING",
  "SUBMITTED",
  "PROCESSING",
  "SUCCEEDED",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];
export type Effect = "NATURAL" | "CINEMATIC" | "CUSTOM";

export interface Generation {
  id: string;
  userId: string;
  chatId: string;
  effect: Effect | null;
  customPrompt: string | null;
  promptText: string | null;
  telegramFileId: string;
  telegramFileUniqueId: string;
  declaredFileSize: number | null;
  status: GenerationStatus;
  sourceUrl: string | null;
  sourcePathname: string | null;
  resultUrl: string | null;
  providerTaskId: string | null;
  safeError: string | null;
  attempts: number;
  sendAttempts: number;
  pollLeaseUntil: Date | null;
  deliveryLeaseUntil: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredAsset {
  url: string;
  pathname: string;
}

export type ConfirmationResult =
  | { kind: "ok"; generation: Generation }
  | { kind: "disabled" | "daily_limit" | "concurrency_limit" | "not_ready" };

export interface GenerationStats {
  users: number;
  byStatus: Partial<Record<GenerationStatus, number>>;
}

export interface AppConfig {
  nodeEnv: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramAdminIds: ReadonlySet<string>;
  videoProvider: "runway" | "kling";
  runwayApiKey: string | null;
  klingApiKey: string | null;
  databaseUrl: string;
  blobToken: string | null;
  cronSecret: string;
  appBaseUrl: string;
  dailyGenerationLimit: number;
  maxConcurrentGenerations: number;
  generationsEnabled: boolean;
  useMockRunway: boolean;
  rateLimitRequests: number;
  rateLimitWindowSeconds: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  sourceTtlHours: number;
  maxSubmissionAttempts: number;
  submissionStaleMinutes: number;
  pollBatchSize: number;
}
