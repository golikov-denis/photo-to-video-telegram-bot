import { describe, expect, it } from "vitest";
import { runWorker } from "@/lib/jobs";
import type { ProviderTask, VideoProvider } from "@/lib/providers/types";
import {
  callbackUpdate,
  createHarness,
  currentGeneration,
  dispatch,
  photoUpdate,
} from "./helpers";

class FailingProvider implements VideoProvider {
  createCalls = 0;

  async create(): Promise<{ id: string }> {
    this.createCalls += 1;
    throw new Error("secret provider response must not reach the user");
  }

  async retrieve(): Promise<ProviderTask> {
    return { status: "FAILED" };
  }

  async downloadResult(): Promise<Buffer> {
    throw new Error("not implemented");
  }
}

describe("provider failures", () => {
  it("marks a provider submission error as FAILED without leaking details", async () => {
    const provider = new FailingProvider();
    const harness = createHarness({ provider });
    await dispatch(harness.deps, photoUpdate());
    await dispatch(harness.deps, callbackUpdate("effect:NATURAL"));

    const generation = currentGeneration(harness.store);
    expect(generation.status).toBe("FAILED");
    expect(generation.safeError).toBe("SUBMISSION_FAILED");
    expect(harness.storage.files.size).toBe(0);
    const messages = harness.calls
      .filter((call) => call.method === "sendMessage")
      .map((call) => JSON.stringify(call.payload));
    expect(messages.at(-1)).toContain("Не удалось создать или отправить видео");
    expect(messages.at(-1)).not.toContain("secret provider response");

    await runWorker(harness.deps);
    expect(provider.createCalls).toBe(1);
    expect(harness.calls.filter((call) => call.method === "sendVideo")).toHaveLength(0);
  });
});
