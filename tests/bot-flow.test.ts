import { describe, expect, it } from "vitest";
import { runWorker } from "@/lib/jobs";
import {
  callbackUpdate,
  createHarness,
  currentGeneration,
  dispatch,
  messageUpdate,
  photoUpdate,
} from "./helpers";

describe("Telegram bot flow", () => {
  it("starts a preset from one click and delivers one MP4", async () => {
    const harness = createHarness({ succeedAfterPolls: 2 });
    await dispatch(harness.deps, messageUpdate("/start"));
    await dispatch(harness.deps, photoUpdate());
    await dispatch(harness.deps, callbackUpdate("effect:NATURAL"));

    let generation = currentGeneration(harness.store);
    expect(generation.status).toBe("SUBMITTED");
    expect(generation.providerTaskId).toMatch(/^mock-/);
    const messages = harness.calls.filter((call) => call.method === "sendMessage");
    expect(messages.at(-1)?.payload).toMatchObject({ text: expect.stringContaining("Принято!") });
    expect(JSON.stringify(messages)).not.toContain("Что будет в видео");

    await runWorker(harness.deps);
    expect(currentGeneration(harness.store).status).toBe("PROCESSING");
    await runWorker(harness.deps);

    generation = currentGeneration(harness.store);
    expect(generation.status).toBe("SENT");
    expect(generation.resultUrl).toMatch(/^mock:\/\/video\//);
    expect(harness.calls.filter((call) => call.method === "sendVideo")).toHaveLength(1);
    expect(harness.storage.files.size).toBe(0);
  });

  it("starts a custom generation immediately after the description", async () => {
    const harness = createHarness();
    await dispatch(harness.deps, photoUpdate());
    await dispatch(harness.deps, callbackUpdate("effect:CUSTOM"));
    expect(currentGeneration(harness.store).status).toBe("WAITING_FOR_PROMPT");

    await dispatch(harness.deps, messageUpdate("человек слегка улыбается"));
    const generation = currentGeneration(harness.store);
    expect(generation.status).toBe("SUBMITTED");
    expect(generation.promptText).toContain("человек слегка улыбается");
    expect(generation.promptText).toContain("Mandatory preservation constraints");

    const messages = harness.calls.filter((call) => call.method === "sendMessage");
    expect(messages.at(-1)?.payload).toMatchObject({ text: expect.stringContaining("Принято!") });
    expect(JSON.stringify(messages)).not.toContain("Что будет в видео");
  });

  it("deduplicates the same Telegram update and its side effects", async () => {
    const harness = createHarness();
    const update = photoUpdate();
    expect(await dispatch(harness.deps, update)).toBe(true);
    expect(await dispatch(harness.deps, update)).toBe(false);
    expect(harness.store.generations.size).toBe(1);
    expect(harness.calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  });

  it("does not send a completed result twice", async () => {
    const harness = createHarness();
    await dispatch(harness.deps, photoUpdate());
    await dispatch(harness.deps, callbackUpdate("effect:CINEMATIC"));
    await runWorker(harness.deps);
    await runWorker(harness.deps);
    expect(currentGeneration(harness.store).status).toBe("SENT");
    expect(harness.calls.filter((call) => call.method === "sendVideo")).toHaveLength(1);
  });

  it("cancels only a draft and checks admin rights on the server", async () => {
    const harness = createHarness();
    await dispatch(harness.deps, photoUpdate());
    await dispatch(harness.deps, messageUpdate("/cancel"));
    expect(currentGeneration(harness.store).status).toBe("CANCELLED");

    await dispatch(harness.deps, messageUpdate("/stats"));
    expect(harness.calls.at(-1)?.method).toBe("sendMessage");
    const payload = harness.calls.at(-1)?.payload as { text?: string };
    expect(payload.text).toContain("Пользователей: 1");
  });
});
