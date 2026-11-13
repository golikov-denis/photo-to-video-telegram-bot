import { describe, expect, it, vi } from "vitest";
import { runWorker } from "@/lib/jobs";
import { createHarness } from "./helpers";

describe("worker database reads", () => {
  it("retries a transient read failure without creating a generation", async () => {
    const harness = createHarness();
    const original = harness.store.listExpiredSources.bind(harness.store);
    const read = vi
      .spyOn(harness.store, "listExpiredSources")
      .mockRejectedValueOnce(new Error("CONNECTION_CLOSED"))
      .mockImplementation(original);

    await expect(runWorker(harness.deps)).resolves.toEqual({
      submitted: 0,
      polled: 0,
      delivered: 0,
      cleaned: 0,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(harness.store.generations.size).toBe(0);
  });
});
