import postgres, { type Sql, type TransactionSql } from "postgres";
import type { CreateDraftInput, Store } from "../domain/store";
import { GENERATION_STATUSES } from "../domain/types";
import type {
  ConfirmationResult,
  Effect,
  Generation,
  GenerationStats,
  GenerationStatus,
  StoredAsset,
} from "../domain/types";

interface GenerationRow {
  id: string;
  user_id: string;
  chat_id: string;
  effect: Effect | null;
  custom_prompt: string | null;
  prompt_text: string | null;
  telegram_file_id: string;
  telegram_file_unique_id: string;
  declared_file_size: number | string | null;
  status: GenerationStatus;
  source_url: string | null;
  source_pathname: string | null;
  result_url: string | null;
  provider_task_id: string | null;
  safe_error: string | null;
  attempts: number;
  send_attempts: number;
  poll_lease_until: Date | string | null;
  delivery_lease_until: Date | string | null;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function date(value: Date | string | null): Date | null {
  return value ? new Date(value) : null;
}

function mapGeneration(row: GenerationRow): Generation {
  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    effect: row.effect,
    customPrompt: row.custom_prompt,
    promptText: row.prompt_text,
    telegramFileId: row.telegram_file_id,
    telegramFileUniqueId: row.telegram_file_unique_id,
    declaredFileSize:
      row.declared_file_size === null ? null : Number(row.declared_file_size),
    status: row.status,
    sourceUrl: row.source_url,
    sourcePathname: row.source_pathname,
    resultUrl: row.result_url,
    providerTaskId: row.provider_task_id,
    safeError: row.safe_error,
    attempts: row.attempts,
    sendAttempts: row.send_attempts,
    pollLeaseUntil: date(row.poll_lease_until),
    deliveryLeaseUntil: date(row.delivery_lease_until),
    confirmedAt: date(row.confirmed_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresStore implements Store {
  constructor(private readonly sql: Sql | TransactionSql) {}

  transaction<T>(work: (transaction: Store) => Promise<T>): Promise<T> {
    return (this.sql as Sql).begin((sql) => work(new PostgresStore(sql))) as Promise<T>;
  }

  async claimUpdate(updateId: number): Promise<boolean> {
    const rows = await this.sql`
      INSERT INTO processed_updates (update_id) VALUES (${updateId})
      ON CONFLICT DO NOTHING RETURNING update_id
    `;
    return rows.length === 1;
  }

  async upsertUser(userId: string, chatId: string): Promise<void> {
    await this.sql`
      INSERT INTO users (telegram_user_id, chat_id) VALUES (${userId}, ${chatId})
      ON CONFLICT (telegram_user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = NOW()
    `;
  }

  async consumeRateLimit(
    userId: string,
    limit: number,
    windowSeconds: number,
    now: Date,
  ): Promise<boolean> {
    const windowMs = windowSeconds * 1000;
    const bucket = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const rows = await this.sql<{ request_count: number }[]>`
      INSERT INTO rate_limit_buckets (user_id, bucket_start, request_count)
      VALUES (${userId}, ${bucket}, 1)
      ON CONFLICT (user_id, bucket_start)
      DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
      RETURNING request_count
    `;
    return (rows[0]?.request_count ?? limit + 1) <= limit;
  }

  async createDraft(input: CreateDraftInput): Promise<Generation> {
    await this.sql`
      UPDATE generations SET status = 'CANCELLED', updated_at = NOW()
      WHERE user_id = ${input.userId} AND status IN ('DRAFT', 'WAITING_FOR_PROMPT')
    `;
    const rows = await this.sql<GenerationRow[]>`
      INSERT INTO generations (
        id, user_id, chat_id, telegram_file_id, telegram_file_unique_id, declared_file_size
      ) VALUES (
        ${input.id}, ${input.userId}, ${input.chatId}, ${input.telegramFileId},
        ${input.telegramFileUniqueId}, ${input.declaredFileSize}
      ) RETURNING *
    `;
    await this.sql`
      INSERT INTO dialog_states (user_id, current_generation_id)
      VALUES (${input.userId}, ${input.id})
      ON CONFLICT (user_id) DO UPDATE SET
        current_generation_id = EXCLUDED.current_generation_id, updated_at = NOW()
    `;
    return mapGeneration(rows[0]!);
  }

  async getGeneration(id: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE id = ${id} LIMIT 1
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async getCurrentGeneration(userId: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT g.* FROM dialog_states d
      JOIN generations g ON g.id = d.current_generation_id
      WHERE d.user_id = ${userId} LIMIT 1
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async getLatestGeneration(userId: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 1
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async setEffect(
    id: string,
    userId: string,
    effect: Effect,
    status: "DRAFT" | "WAITING_FOR_PROMPT",
    promptText: string | null,
  ): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        effect = ${effect}, status = ${status}, prompt_text = ${promptText},
        custom_prompt = NULL, safe_error = NULL, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
        AND status IN ('DRAFT', 'WAITING_FOR_PROMPT')
      RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async setCustomPrompt(
    id: string,
    userId: string,
    customPrompt: string,
    promptText: string,
  ): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        custom_prompt = ${customPrompt}, prompt_text = ${promptText},
        status = 'DRAFT', updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
        AND status = 'WAITING_FOR_PROMPT' AND effect = 'CUSTOM'
      RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async cancelDraft(id: string, userId: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
        AND status IN ('DRAFT', 'WAITING_FOR_PROMPT')
      RETURNING *
    `;
    if (rows[0]) {
      await this.sql`DELETE FROM dialog_states WHERE user_id = ${userId}`;
      return mapGeneration(rows[0]);
    }
    return null;
  }

  async confirmGeneration(
    id: string,
    userId: string,
    dailyLimit: number,
    maxConcurrent: number,
    enabled: boolean,
  ): Promise<ConfirmationResult> {
    if (!enabled) return { kind: "disabled" };
    await this.sql`SELECT pg_advisory_xact_lock(918273645)`;
    const drafts = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE id = ${id} AND user_id = ${userId}
        AND status = 'DRAFT' AND prompt_text IS NOT NULL FOR UPDATE
    `;
    if (!drafts[0]) return { kind: "not_ready" };

    const daily = await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM generations
      WHERE user_id = ${userId}
        AND confirmed_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    `;
    if ((daily[0]?.count ?? 0) >= dailyLimit) return { kind: "daily_limit" };

    const active = await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM generations
      WHERE status IN ('CONFIRMED', 'UPLOADING', 'SUBMITTED', 'PROCESSING', 'SUCCEEDED')
    `;
    if ((active[0]?.count ?? 0) >= maxConcurrent) {
      return { kind: "concurrency_limit" };
    }

    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'CONFIRMED', confirmed_at = NOW(), safe_error = NULL, updated_at = NOW()
      WHERE id = ${id} AND status = 'DRAFT' RETURNING *
    `;
    return rows[0]
      ? { kind: "ok", generation: mapGeneration(rows[0]) }
      : { kind: "not_ready" };
  }

  async claimSubmission(id: string, maxAttempts: number): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'UPLOADING', attempts = attempts + 1, safe_error = NULL, updated_at = NOW()
      WHERE id = ${id} AND status = 'CONFIRMED' AND attempts < ${maxAttempts}
      RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async attachSource(id: string, asset: StoredAsset): Promise<void> {
    await this.sql`
      UPDATE generations SET
        source_url = ${asset.url}, source_pathname = ${asset.pathname}, updated_at = NOW()
      WHERE id = ${id} AND status = 'UPLOADING'
    `;
  }

  async requeueSubmission(id: string, safeError: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'CONFIRMED', safe_error = ${safeError}, source_url = NULL,
        source_pathname = NULL, updated_at = NOW()
      WHERE id = ${id} AND status = 'UPLOADING' RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async markSubmitted(id: string, providerTaskId: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'SUBMITTED', provider_task_id = ${providerTaskId}, updated_at = NOW()
      WHERE id = ${id} AND status = 'UPLOADING' RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async listConfirmed(limit: number): Promise<Generation[]> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE status = 'CONFIRMED'
      ORDER BY created_at LIMIT ${limit}
    `;
    return rows.map(mapGeneration);
  }

  async listInterruptedUploads(olderThan: Date, limit: number): Promise<Generation[]> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE status = 'UPLOADING' AND updated_at < ${olderThan}
      ORDER BY updated_at LIMIT ${limit}
    `;
    return rows.map(mapGeneration);
  }

  async listPollable(limit: number): Promise<Generation[]> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations
      WHERE provider_task_id IS NOT NULL AND (
        status = 'SUBMITTED' OR
        (status = 'PROCESSING' AND (poll_lease_until IS NULL OR poll_lease_until < NOW()))
      ) ORDER BY updated_at LIMIT ${limit}
    `;
    return rows.map(mapGeneration);
  }

  async claimPoll(id: string, leaseSeconds: number): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'PROCESSING', attempts = attempts + 1,
        poll_lease_until = NOW() + (${leaseSeconds} * INTERVAL '1 second'), updated_at = NOW()
      WHERE id = ${id} AND provider_task_id IS NOT NULL AND (
        status = 'SUBMITTED' OR
        (status = 'PROCESSING' AND (poll_lease_until IS NULL OR poll_lease_until < NOW()))
      ) RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async releasePoll(id: string): Promise<void> {
    await this.sql`
      UPDATE generations SET poll_lease_until = NULL, updated_at = NOW()
      WHERE id = ${id} AND status = 'PROCESSING'
    `;
  }

  async markSucceeded(id: string, resultUrl: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'SUCCEEDED', result_url = ${resultUrl}, poll_lease_until = NULL,
        safe_error = NULL, updated_at = NOW()
      WHERE id = ${id} AND status = 'PROCESSING' RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async listSucceeded(limit: number): Promise<Generation[]> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE status = 'SUCCEEDED' AND result_url IS NOT NULL
        AND (delivery_lease_until IS NULL OR delivery_lease_until < NOW())
      ORDER BY updated_at LIMIT ${limit}
    `;
    return rows.map(mapGeneration);
  }

  async claimDelivery(id: string, leaseSeconds: number): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        send_attempts = send_attempts + 1,
        delivery_lease_until = NOW() + (${leaseSeconds} * INTERVAL '1 second'),
        updated_at = NOW()
      WHERE id = ${id} AND status = 'SUCCEEDED' AND result_url IS NOT NULL
        AND (delivery_lease_until IS NULL OR delivery_lease_until < NOW())
      RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async releaseDelivery(id: string, safeError: string): Promise<void> {
    await this.sql`
      UPDATE generations SET
        delivery_lease_until = NULL, safe_error = ${safeError}, updated_at = NOW()
      WHERE id = ${id} AND status = 'SUCCEEDED'
    `;
  }

  async markSent(id: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'SENT', delivery_lease_until = NULL, safe_error = NULL, updated_at = NOW()
      WHERE id = ${id} AND status = 'SUCCEEDED' RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async markFailed(id: string, safeError: string): Promise<Generation | null> {
    const rows = await this.sql<GenerationRow[]>`
      UPDATE generations SET
        status = 'FAILED', safe_error = ${safeError}, poll_lease_until = NULL,
        delivery_lease_until = NULL, updated_at = NOW()
      WHERE id = ${id} AND status IN (
        'CONFIRMED', 'UPLOADING', 'SUBMITTED', 'PROCESSING', 'SUCCEEDED'
      ) RETURNING *
    `;
    return rows[0] ? mapGeneration(rows[0]) : null;
  }

  async listExpiredSources(ttlHours: number, limit: number): Promise<Generation[]> {
    const rows = await this.sql<GenerationRow[]>`
      SELECT * FROM generations WHERE source_pathname IS NOT NULL AND (
        status IN ('SENT', 'FAILED', 'CANCELLED') OR
        created_at < NOW() - (${ttlHours} * INTERVAL '1 hour')
      ) ORDER BY created_at LIMIT ${limit}
    `;
    return rows.map(mapGeneration);
  }

  async clearSource(id: string): Promise<void> {
    await this.sql`
      UPDATE generations SET source_url = NULL, source_pathname = NULL, updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async getStats(): Promise<GenerationStats> {
    const users = await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM users
    `;
    const statuses = await this.sql<{ status: GenerationStatus; count: number }[]>`
      SELECT status, COUNT(*)::int AS count FROM generations GROUP BY status
    `;
    const byStatus: GenerationStats["byStatus"] = {};
    for (const row of statuses) byStatus[row.status] = row.count;
    return { users: users[0]?.count ?? 0, byStatus };
  }
}

let singleton: Sql | undefined;

export function getPostgresStore(databaseUrl: string): PostgresStore {
  singleton ??= postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return new PostgresStore(singleton);
}

export function isGenerationStatus(value: string): value is GenerationStatus {
  return GENERATION_STATUSES.includes(value as GenerationStatus);
}
