import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import RunwayML from "@runwayml/sdk";
import { MODEL_ID, VIDEO_DURATION_SECONDS, VIDEO_RATIO } from "../domain/prompts";
import { downloadBounded, DownloadError } from "../http";
import { validateMp4 } from "./mp4";
import type { CreateVideoInput, ProviderTask, VideoProvider } from "./types";

export class RunwayProvider implements VideoProvider {
  private readonly client: RunwayML;

  constructor(apiKey: string) {
    this.client = new RunwayML({ apiKey });
  }

  async create(input: CreateVideoInput): Promise<{ id: string }> {
    const task = await this.client.imageToVideo.create({
      model: MODEL_ID,
      promptImage: input.sourceUrl,
      promptText: input.promptText,
      duration: VIDEO_DURATION_SECONDS,
      ratio: VIDEO_RATIO,
    });
    return { id: task.id };
  }

  async retrieve(id: string): Promise<ProviderTask> {
    const task = await this.client.tasks.retrieve(id);
    switch (task.status) {
      case "SUCCEEDED": {
        const outputUrl = task.output[0];
        if (!outputUrl) return { status: "FAILED" };
        return { status: "SUCCEEDED", outputUrl };
      }
      case "FAILED":
        return { status: "FAILED" };
      case "CANCELLED":
        return { status: "CANCELLED" };
      default:
        return { status: task.status };
    }
  }

  async downloadResult(outputUrl: string, maxBytes: number): Promise<Buffer> {
    const bytes = await downloadBounded(outputUrl, {
      maxBytes,
      timeoutMs: 45_000,
    });
    validateMp4(bytes);
    return bytes;
  }
}

export class MockRunwayProvider implements VideoProvider {
  private readonly tasks = new Map<string, { polls: number }>();

  constructor(private readonly succeedAfterPolls = 2) {}

  async create(): Promise<{ id: string }> {
    const id = `mock-${randomUUID()}`;
    this.tasks.set(id, { polls: 0 });
    return { id };
  }

  async retrieve(id: string): Promise<ProviderTask> {
    const task = this.tasks.get(id);
    if (!task) return { status: "FAILED" };
    task.polls += 1;
    if (task.polls < this.succeedAfterPolls) return { status: "RUNNING" };
    return { status: "SUCCEEDED", outputUrl: `mock://video/${id}` };
  }

  async downloadResult(outputUrl: string, maxBytes: number): Promise<Buffer> {
    if (!outputUrl.startsWith("mock://video/")) {
      throw new DownloadError("Unexpected MOCK output URL.");
    }
    const bytes = await readFile(path.join(process.cwd(), "assets", "mock.mp4"));
    if (bytes.length > maxBytes) throw new DownloadError("MOCK video is too large.");
    return bytes;
  }
}
