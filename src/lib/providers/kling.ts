import { VIDEO_DURATION_SECONDS } from "../domain/prompts";
import { downloadBounded } from "../http";
import { validateMp4 } from "./mp4";
import type { CreateVideoInput, ProviderTask, VideoProvider } from "./types";

const DEFAULT_BASE_URL = "https://api-singapore.klingai.com";

interface KlingEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
}

export class KlingProvider implements VideoProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = DEFAULT_BASE_URL,
  ) {}

  async create(input: CreateVideoInput): Promise<{ id: string }> {
    const extension = new URL(input.sourceUrl).pathname.split(".").at(-1)?.toLowerCase();
    if (!extension || !["jpg", "jpeg", "png"].includes(extension)) {
      throw new Error("Kling supports only JPEG and PNG source images.");
    }

    const envelope = await this.request("/image-to-video/kling-4.0-flash", {
      method: "POST",
      body: JSON.stringify({
        contents: [
          { type: "prompt", text: input.promptText },
          { type: "first_frame", url: input.sourceUrl },
        ],
        settings: {
          resolution: "720p",
          duration: VIDEO_DURATION_SECONDS,
        },
        options: {
          watermark_info: { enabled: false },
        },
      }),
    });
    const data = envelope.data as { id?: unknown } | undefined;
    if (typeof data?.id !== "string" || !data.id) {
      throw new Error("Kling task ID is missing.");
    }
    return { id: data.id };
  }

  async retrieve(id: string): Promise<ProviderTask> {
    const envelope = await this.request(`/tasks?task_ids=${encodeURIComponent(id)}`, {
      method: "GET",
    });
    if (!Array.isArray(envelope.data)) throw new Error("Kling task list is invalid.");
    const task = envelope.data.find(
      (value): value is { id: string; status?: unknown; outputs?: unknown } =>
        typeof value === "object" && value !== null && (value as { id?: unknown }).id === id,
    );
    if (!task) throw new Error("Kling task is missing from the response.");

    switch (task.status) {
      case "submitted":
        return { status: "PENDING" };
      case "processing":
        return { status: "RUNNING" };
      case "failed":
        return { status: "FAILED" };
      case "succeeded": {
        const outputs = Array.isArray(task.outputs) ? task.outputs : [];
        const video = outputs.find(
          (value): value is { type: "video"; url: string } =>
            typeof value === "object" &&
            value !== null &&
            (value as { type?: unknown }).type === "video" &&
            typeof (value as { url?: unknown }).url === "string" &&
            Boolean((value as { url?: unknown }).url),
        );
        return video ? { status: "SUCCEEDED", outputUrl: video.url } : { status: "FAILED" };
      }
      default:
        throw new Error("Kling task status is unknown.");
    }
  }

  async downloadResult(outputUrl: string, maxBytes: number): Promise<Buffer> {
    const bytes = await downloadBounded(outputUrl, {
      maxBytes,
      timeoutMs: 45_000,
      fetchImpl: this.fetchImpl,
    });
    validateMp4(bytes);
    return bytes;
  }

  private async request(path: string, init: RequestInit): Promise<KlingEnvelope> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(init.method === "POST" ? 30_000 : 20_000),
      });
    } catch {
      throw new Error("Kling API request failed.");
    }

    let envelope: KlingEnvelope;
    try {
      envelope = (await response.json()) as KlingEnvelope;
    } catch {
      throw new Error("Kling API returned invalid JSON.");
    }
    if (!response.ok) throw new Error(`Kling API HTTP ${response.status}.`);
    if (envelope.code !== 0) {
      throw new Error(`Kling API error ${envelope.code ?? "unknown"}.`);
    }
    return envelope;
  }
}
