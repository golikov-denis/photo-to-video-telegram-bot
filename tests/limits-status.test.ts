import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { buildPrompt } from "@/lib/domain/prompts";
import { canTransition } from "@/lib/domain/status";

async function confirmedDraft(store: MemoryStore, id: string) {
  await store.upsertUser("42", "42");
  await store.createDraft({
    id,
    userId: "42",
    chatId: "42",
    telegramFileId: `file-${id}`,
    telegramFileUniqueId: `unique-${id}`,
    declaredFileSize: 100,
  });
  await store.setEffect(id, "42", "NATURAL", "DRAFT", buildPrompt("NATURAL"));
  return store.confirmGeneration(id, "42", 1, 10, true);
}

describe("generation limits and states", () => {
  it("enforces the daily limit at confirmation time", async () => {
    const store = new MemoryStore();
    const first = await confirmedDraft(store, "10000000-0000-4000-8000-000000000001");
    expect(first.kind).toBe("ok");
    const second = await confirmedDraft(store, "10000000-0000-4000-8000-000000000002");
    expect(second.kind).toBe("daily_limit");
  });

  it("enforces the global active generation limit", async () => {
    const store = new MemoryStore();
    await store.upsertUser("42", "42");
    await store.createDraft({
      id: "10000000-0000-4000-8000-000000000003",
      userId: "42",
      chatId: "42",
      telegramFileId: "file",
      telegramFileUniqueId: "unique",
      declaredFileSize: 100,
    });
    await store.setEffect(
      "10000000-0000-4000-8000-000000000003",
      "42",
      "NATURAL",
      "DRAFT",
      buildPrompt("NATURAL"),
    );
    const result = await store.confirmGeneration(
      "10000000-0000-4000-8000-000000000003",
      "42",
      10,
      1,
      true,
    );
    expect(result.kind).toBe("ok");
    const blocked = await store.confirmGeneration(
      "10000000-0000-4000-8000-000000000003",
      "42",
      10,
      1,
      true,
    );
    expect(blocked.kind).toBe("not_ready");
  });

  it("allows only valid status transitions", () => {
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "UPLOADING")).toBe(true);
    expect(canTransition("UPLOADING", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "SUCCEEDED")).toBe(true);
    expect(canTransition("SUCCEEDED", "SENT")).toBe(true);
    expect(canTransition("SENT", "PROCESSING")).toBe(false);
    expect(canTransition("FAILED", "CONFIRMED")).toBe(false);
    expect(canTransition("PROCESSING", "DRAFT")).toBe(false);
  });
});
