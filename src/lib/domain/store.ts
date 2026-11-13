import type {
  ConfirmationResult,
  Effect,
  Generation,
  GenerationStats,
  StoredAsset,
} from "./types";

export interface CreateDraftInput {
  id: string;
  userId: string;
  chatId: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  declaredFileSize: number | null;
}

export interface Store {
  transaction<T>(work: (transaction: Store) => Promise<T>): Promise<T>;
  claimUpdate(updateId: number): Promise<boolean>;
  upsertUser(userId: string, chatId: string): Promise<void>;
  consumeRateLimit(
    userId: string,
    limit: number,
    windowSeconds: number,
    now: Date,
  ): Promise<boolean>;
  createDraft(input: CreateDraftInput): Promise<Generation>;
  getGeneration(id: string): Promise<Generation | null>;
  getCurrentGeneration(userId: string): Promise<Generation | null>;
  getLatestGeneration(userId: string): Promise<Generation | null>;
  setEffect(
    id: string,
    userId: string,
    effect: Effect,
    status: "DRAFT" | "WAITING_FOR_PROMPT",
    promptText: string | null,
  ): Promise<Generation | null>;
  setCustomPrompt(
    id: string,
    userId: string,
    customPrompt: string,
    promptText: string,
  ): Promise<Generation | null>;
  cancelDraft(id: string, userId: string): Promise<Generation | null>;
  confirmGeneration(
    id: string,
    userId: string,
    dailyLimit: number,
    maxConcurrent: number,
    enabled: boolean,
  ): Promise<ConfirmationResult>;
  claimSubmission(id: string, maxAttempts: number): Promise<Generation | null>;
  attachSource(id: string, asset: StoredAsset): Promise<void>;
  requeueSubmission(id: string, safeError: string): Promise<Generation | null>;
  markSubmitted(id: string, providerTaskId: string): Promise<Generation | null>;
  listConfirmed(limit: number): Promise<Generation[]>;
  listInterruptedUploads(olderThan: Date, limit: number): Promise<Generation[]>;
  listPollable(limit: number): Promise<Generation[]>;
  claimPoll(id: string, leaseSeconds: number): Promise<Generation | null>;
  releasePoll(id: string): Promise<void>;
  markSucceeded(id: string, resultUrl: string): Promise<Generation | null>;
  listSucceeded(limit: number): Promise<Generation[]>;
  claimDelivery(id: string, leaseSeconds: number): Promise<Generation | null>;
  releaseDelivery(id: string, safeError: string): Promise<void>;
  markSent(id: string): Promise<Generation | null>;
  markFailed(id: string, safeError: string): Promise<Generation | null>;
  listExpiredSources(ttlHours: number, limit: number): Promise<Generation[]>;
  clearSource(id: string): Promise<void>;
  getStats(): Promise<GenerationStats>;
}
