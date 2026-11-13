import type { CreateDraftInput, Store } from "../domain/store";
import { isDraftStatus, isTerminalStatus } from "../domain/status";
import type {
  ConfirmationResult,
  Effect,
  Generation,
  GenerationStats,
  StoredAsset,
} from "../domain/types";

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryStore implements Store {
  readonly generations = new Map<string, Generation>();
  readonly processedUpdates = new Set<number>();
  readonly users = new Map<string, string>();
  private readonly current = new Map<string, string>();
  private readonly rateBuckets = new Map<string, number>();

  async transaction<T>(work: (transaction: Store) => Promise<T>): Promise<T> {
    return work(this);
  }

  async claimUpdate(updateId: number): Promise<boolean> {
    if (this.processedUpdates.has(updateId)) return false;
    this.processedUpdates.add(updateId);
    return true;
  }

  async upsertUser(userId: string, chatId: string): Promise<void> {
    this.users.set(userId, chatId);
  }

  async consumeRateLimit(
    userId: string,
    limit: number,
    windowSeconds: number,
    now: Date,
  ): Promise<boolean> {
    const windowMs = windowSeconds * 1000;
    const bucket = Math.floor(now.getTime() / windowMs);
    const key = `${userId}:${bucket}`;
    const count = (this.rateBuckets.get(key) ?? 0) + 1;
    this.rateBuckets.set(key, count);
    return count <= limit;
  }

  async createDraft(input: CreateDraftInput): Promise<Generation> {
    for (const generation of this.generations.values()) {
      if (generation.userId === input.userId && isDraftStatus(generation.status)) {
        generation.status = "CANCELLED";
        generation.updatedAt = new Date();
      }
    }
    const now = new Date();
    const generation: Generation = {
      ...input,
      effect: null,
      customPrompt: null,
      promptText: null,
      status: "DRAFT",
      sourceUrl: null,
      sourcePathname: null,
      resultUrl: null,
      providerTaskId: null,
      safeError: null,
      attempts: 0,
      sendAttempts: 0,
      pollLeaseUntil: null,
      deliveryLeaseUntil: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.generations.set(generation.id, generation);
    this.current.set(input.userId, generation.id);
    return clone(generation);
  }

  async getGeneration(id: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    return value ? clone(value) : null;
  }

  async getCurrentGeneration(userId: string): Promise<Generation | null> {
    const id = this.current.get(userId);
    return id ? this.getGeneration(id) : null;
  }

  async getLatestGeneration(userId: string): Promise<Generation | null> {
    const values = [...this.generations.values()]
      .filter((value) => value.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return values[0] ? clone(values[0]) : null;
  }

  async setEffect(
    id: string,
    userId: string,
    effect: Effect,
    status: "DRAFT" | "WAITING_FOR_PROMPT",
    promptText: string | null,
  ): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (!value || value.userId !== userId || !isDraftStatus(value.status)) return null;
    Object.assign(value, {
      effect,
      status,
      promptText,
      customPrompt: null,
      safeError: null,
      updatedAt: new Date(),
    });
    return clone(value);
  }

  async setCustomPrompt(
    id: string,
    userId: string,
    customPrompt: string,
    promptText: string,
  ): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (
      !value ||
      value.userId !== userId ||
      value.status !== "WAITING_FOR_PROMPT" ||
      value.effect !== "CUSTOM"
    ) {
      return null;
    }
    Object.assign(value, {
      customPrompt,
      promptText,
      status: "DRAFT",
      updatedAt: new Date(),
    });
    return clone(value);
  }

  async cancelDraft(id: string, userId: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (!value || value.userId !== userId || !isDraftStatus(value.status)) return null;
    value.status = "CANCELLED";
    value.updatedAt = new Date();
    this.current.delete(userId);
    return clone(value);
  }

  async confirmGeneration(
    id: string,
    userId: string,
    dailyLimit: number,
    maxConcurrent: number,
    enabled: boolean,
  ): Promise<ConfirmationResult> {
    if (!enabled) return { kind: "disabled" };
    const value = this.generations.get(id);
    if (!value || value.userId !== userId || value.status !== "DRAFT" || !value.promptText) {
      return { kind: "not_ready" };
    }
    const utcDay = new Date().toISOString().slice(0, 10);
    const daily = [...this.generations.values()].filter(
      (item) =>
        item.userId === userId &&
        item.confirmedAt?.toISOString().slice(0, 10) === utcDay,
    ).length;
    if (daily >= dailyLimit) return { kind: "daily_limit" };
    const active = [...this.generations.values()].filter((item) =>
      ["CONFIRMED", "UPLOADING", "SUBMITTED", "PROCESSING", "SUCCEEDED"].includes(
        item.status,
      ),
    ).length;
    if (active >= maxConcurrent) return { kind: "concurrency_limit" };
    value.status = "CONFIRMED";
    value.confirmedAt = new Date();
    value.safeError = null;
    value.updatedAt = new Date();
    return { kind: "ok", generation: clone(value) };
  }

  async claimSubmission(id: string, maxAttempts: number): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (!value || value.status !== "CONFIRMED" || value.attempts >= maxAttempts) {
      return null;
    }
    value.status = "UPLOADING";
    value.attempts += 1;
    value.safeError = null;
    value.updatedAt = new Date();
    return clone(value);
  }

  async attachSource(id: string, asset: StoredAsset): Promise<void> {
    const value = this.generations.get(id);
    if (value?.status === "UPLOADING") {
      value.sourceUrl = asset.url;
      value.sourcePathname = asset.pathname;
      value.updatedAt = new Date();
    }
  }

  async requeueSubmission(id: string, safeError: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (value?.status !== "UPLOADING") return null;
    value.status = "CONFIRMED";
    value.safeError = safeError;
    value.sourceUrl = null;
    value.sourcePathname = null;
    value.updatedAt = new Date();
    return clone(value);
  }

  async markSubmitted(id: string, providerTaskId: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (value?.status !== "UPLOADING") return null;
    value.status = "SUBMITTED";
    value.providerTaskId = providerTaskId;
    value.updatedAt = new Date();
    return clone(value);
  }

  async listConfirmed(limit: number): Promise<Generation[]> {
    return this.list((value) => value.status === "CONFIRMED", limit);
  }

  async listInterruptedUploads(olderThan: Date, limit: number): Promise<Generation[]> {
    return this.list(
      (value) => value.status === "UPLOADING" && value.updatedAt < olderThan,
      limit,
    );
  }

  async listPollable(limit: number): Promise<Generation[]> {
    const now = Date.now();
    return this.list(
      (value) =>
        value.providerTaskId !== null &&
        (value.status === "SUBMITTED" ||
          (value.status === "PROCESSING" &&
            (!value.pollLeaseUntil || value.pollLeaseUntil.getTime() < now))),
      limit,
    );
  }

  async claimPoll(id: string, leaseSeconds: number): Promise<Generation | null> {
    const candidates = await this.listPollable(10_000);
    const value = this.generations.get(id);
    if (!value || !candidates.some((item) => item.id === id)) return null;
    value.status = "PROCESSING";
    value.attempts += 1;
    value.pollLeaseUntil = new Date(Date.now() + leaseSeconds * 1000);
    value.updatedAt = new Date();
    return clone(value);
  }

  async releasePoll(id: string): Promise<void> {
    const value = this.generations.get(id);
    if (value?.status === "PROCESSING") {
      value.pollLeaseUntil = null;
      value.updatedAt = new Date();
    }
  }

  async markSucceeded(id: string, resultUrl: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (value?.status !== "PROCESSING") return null;
    value.status = "SUCCEEDED";
    value.resultUrl = resultUrl;
    value.pollLeaseUntil = null;
    value.safeError = null;
    value.updatedAt = new Date();
    return clone(value);
  }

  async listSucceeded(limit: number): Promise<Generation[]> {
    const now = Date.now();
    return this.list(
      (value) =>
        value.status === "SUCCEEDED" &&
        value.resultUrl !== null &&
        (!value.deliveryLeaseUntil || value.deliveryLeaseUntil.getTime() < now),
      limit,
    );
  }

  async claimDelivery(id: string, leaseSeconds: number): Promise<Generation | null> {
    const candidates = await this.listSucceeded(10_000);
    const value = this.generations.get(id);
    if (!value || !candidates.some((item) => item.id === id)) return null;
    value.sendAttempts += 1;
    value.deliveryLeaseUntil = new Date(Date.now() + leaseSeconds * 1000);
    value.updatedAt = new Date();
    return clone(value);
  }

  async releaseDelivery(id: string, safeError: string): Promise<void> {
    const value = this.generations.get(id);
    if (value?.status === "SUCCEEDED") {
      value.deliveryLeaseUntil = null;
      value.safeError = safeError;
      value.updatedAt = new Date();
    }
  }

  async markSent(id: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (value?.status !== "SUCCEEDED") return null;
    value.status = "SENT";
    value.deliveryLeaseUntil = null;
    value.safeError = null;
    value.updatedAt = new Date();
    return clone(value);
  }

  async markFailed(id: string, safeError: string): Promise<Generation | null> {
    const value = this.generations.get(id);
    if (
      !value ||
      !["CONFIRMED", "UPLOADING", "SUBMITTED", "PROCESSING", "SUCCEEDED"].includes(
        value.status,
      )
    ) {
      return null;
    }
    value.status = "FAILED";
    value.safeError = safeError;
    value.pollLeaseUntil = null;
    value.deliveryLeaseUntil = null;
    value.updatedAt = new Date();
    return clone(value);
  }

  async listExpiredSources(ttlHours: number, limit: number): Promise<Generation[]> {
    const threshold = Date.now() - ttlHours * 3_600_000;
    return this.list(
      (value) =>
        value.sourcePathname !== null &&
        (isTerminalStatus(value.status) || value.createdAt.getTime() < threshold),
      limit,
    );
  }

  async clearSource(id: string): Promise<void> {
    const value = this.generations.get(id);
    if (value) {
      value.sourceUrl = null;
      value.sourcePathname = null;
      value.updatedAt = new Date();
    }
  }

  async getStats(): Promise<GenerationStats> {
    const byStatus: GenerationStats["byStatus"] = {};
    for (const value of this.generations.values()) {
      byStatus[value.status] = (byStatus[value.status] ?? 0) + 1;
    }
    return { users: this.users.size, byStatus };
  }

  addGeneration(value: Generation): void {
    this.generations.set(value.id, clone(value));
    this.users.set(value.userId, value.chatId);
  }

  private list(predicate: (value: Generation) => boolean, limit: number): Generation[] {
    return [...this.generations.values()]
      .filter(predicate)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }
}
