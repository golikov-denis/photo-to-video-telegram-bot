import { describe, expect, it } from "vitest";
import { createHarness, currentGeneration, dispatch, messageUpdate, photoUpdate } from "./helpers";

describe("task identifiers in the user interface", () => {
  it("keeps internal task IDs out of photo confirmation and status messages", async () => {
    const harness = createHarness();
    await dispatch(harness.deps, photoUpdate());
    const generation = currentGeneration(harness.store);

    expect(harness.calls[0]?.payload).toMatchObject({
      text: "Фотография принята! Выберите эффект — создание видео начнётся автоматически:",
    });

    await dispatch(harness.deps, messageUpdate("/status"));
    const texts = harness.calls
      .filter((call) => call.method === "sendMessage")
      .map((call) => (call.payload as { text?: string }).text ?? "");
    for (const text of texts) {
      expect(text).not.toContain(generation.id);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});
