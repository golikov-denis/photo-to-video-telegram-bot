import { Api } from "grammy";
import type { Update } from "grammy/types";
import { loadConfig } from "@/lib/config";
import { MemoryStore } from "@/lib/db/memory-store";
import type { AppConfig, StoredAsset } from "@/lib/domain/types";
import type { ImageMetadata } from "@/lib/images";
import type { JobDependencies } from "@/lib/jobs";
import { MockRunwayProvider } from "@/lib/providers/runway";
import type { VideoProvider } from "@/lib/providers/types";
import type { SourceStorage } from "@/lib/storage";
import { processTelegramUpdate } from "@/lib/telegram/update";

export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

export class MemoryStorage implements SourceStorage {
  readonly files = new Map<string, Buffer>();
  readonly deleted: string[] = [];

  async putSource(
    taskId: string,
    bytes: Buffer,
    image: ImageMetadata,
  ): Promise<StoredAsset> {
    const pathname = `sources/${taskId}.${image.extension}`;
    this.files.set(pathname, bytes);
    return { url: `https://storage.test/${pathname}`, pathname };
  }

  async deleteSource(asset: StoredAsset): Promise<void> {
    this.files.delete(asset.pathname);
    this.deleted.push(asset.pathname);
  }
}

export interface ApiCall {
  method: string;
  payload: unknown;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    TELEGRAM_BOT_TOKEN: "123:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret_1234567890",
    TELEGRAM_ADMIN_IDS: "42",
    RUNWAYML_API_SECRET: "",
    DATABASE_URL: "postgresql://localhost/test",
    BLOB_READ_WRITE_TOKEN: "",
    CRON_SECRET: "test-cron-secret-1234567890",
    APP_BASE_URL: "http://localhost:3000",
    USE_MOCK_RUNWAY: "true",
    ...overrides,
  });
}

export function createHarness(options: {
  provider?: VideoProvider;
  config?: AppConfig;
  succeedAfterPolls?: number;
} = {}) {
  const config = options.config ?? testConfig();
  const store = new MemoryStore();
  const provider = options.provider ?? new MockRunwayProvider(options.succeedAfterPolls ?? 1);
  const storage = new MemoryStorage();
  const calls: ApiCall[] = [];
  const configureApi = (target: Api) => {
    target.config.use(async (_previous, method, payload) => {
      calls.push({ method, payload });
      const result = method === "getFile" ? { file_path: "photos/test.jpg" } : {};
      return { ok: true, result } as never;
    });
  };
  const api = new Api(config.telegramBotToken);
  configureApi(api);
  const deps: JobDependencies = {
    config,
    store,
    provider,
    storage,
    api,
    configureApi,
    downloadPhoto: async () => JPEG_BYTES,
  };
  return { config, store, provider, storage, calls, api, deps };
}

let updateId = 1000;
const from = { id: 42, is_bot: false, first_name: "Test" };
const chat = { id: 42, type: "private", first_name: "Test" };

export function messageUpdate(text: string, id = ++updateId): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat,
      from,
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.length }]
        : undefined,
    },
  } as Update;
}

export function photoUpdate(id = ++updateId): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat,
      from,
      photo: [
        {
          file_id: "telegram-photo-id",
          file_unique_id: "telegram-photo-unique-id",
          width: 1280,
          height: 720,
          file_size: 1024,
        },
      ],
    },
  } as Update;
}

export function callbackUpdate(data: string, id = ++updateId): Update {
  return {
    update_id: id,
    callback_query: {
      id: String(id),
      from,
      chat_instance: "test-chat-instance",
      data,
      message: {
        message_id: id,
        date: Math.floor(Date.now() / 1000),
        chat,
        from: { id: 999, is_bot: true, first_name: "Bot" },
      },
    },
  } as Update;
}

export async function dispatch(
  deps: JobDependencies,
  update: Update,
  runJobs = true,
): Promise<boolean> {
  const result = await processTelegramUpdate(update, deps);
  if (runJobs) {
    for (const job of result.jobs) await job();
  }
  return result.handled;
}

export function currentGeneration(store: MemoryStore) {
  const values = [...store.generations.values()];
  if (values.length !== 1) throw new Error(`Expected one generation, got ${values.length}`);
  return values[0]!;
}
