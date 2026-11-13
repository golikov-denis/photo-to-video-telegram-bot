import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/config";
import { KlingProvider } from "@/lib/providers/kling";
import { testConfig } from "./helpers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("official Kling provider", () => {
  it("creates a 4.0 Flash task with the documented payload and bearer key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: 0, data: { id: "task-123" } }),
    );
    const provider = new KlingProvider("secret-kling-key", fetchMock);

    await expect(
      provider.create({
        sourceUrl: "https://storage.test/sources/photo.jpg",
        promptText: "Gentle motion",
      }),
    ).resolves.toEqual({ id: "task-123" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api-singapore.klingai.com/image-to-video/kling-4.0-flash");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer secret-kling-key",
      "content-type": "application/json",
    });
    const payload = JSON.parse(String(init?.body));
    expect(payload).toEqual({
      contents: [
        { type: "prompt", text: "Gentle motion" },
        { type: "first_frame", url: "https://storage.test/sources/photo.jpg" },
      ],
      settings: { resolution: "720p", duration: 5 },
      options: { watermark_info: { enabled: false } },
    });
    expect(payload.settings).not.toHaveProperty("aspect_ratio");
  });

  it.each([
    ["submitted", { status: "PENDING" }],
    ["processing", { status: "RUNNING" }],
    ["failed", { status: "FAILED" }],
  ])("maps %s task status", async (apiStatus, expected) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: 0, data: [{ id: "task-123", status: apiStatus }] }),
    );
    const provider = new KlingProvider("key", fetchMock);
    await expect(provider.retrieve("task-123")).resolves.toEqual(expected);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api-singapore.klingai.com/tasks?task_ids=task-123",
    );
  });

  it("returns the video output for a succeeded task", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: [
          {
            id: "task-123",
            status: "succeeded",
            outputs: [
              { type: "image", url: "https://cdn.test/cover.jpg" },
              { type: "video", url: "https://cdn.test/result.mp4" },
            ],
          },
        ],
      }),
    );
    const provider = new KlingProvider("key", fetchMock);
    await expect(provider.retrieve("task-123")).resolves.toEqual({
      status: "SUCCEEDED",
      outputUrl: "https://cdn.test/result.mp4",
    });
  });

  it("fails safely when a succeeded task has no video URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ code: 0, data: [{ id: "task-123", status: "succeeded", outputs: [] }] }),
    );
    const provider = new KlingProvider("key", fetchMock);
    await expect(provider.retrieve("task-123")).resolves.toEqual({ status: "FAILED" });
  });

  it("throws API and transport errors so polling can retry the same task", async () => {
    const apiError = new KlingProvider(
      "key",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ code: 401, message: "Unauthorized", data: [] }),
      ),
    );
    await expect(apiError.retrieve("task-123")).rejects.toThrow("Kling API error 401");

    const networkError = new KlingProvider(
      "key",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network secret")),
    );
    await expect(networkError.retrieve("task-123")).rejects.toThrow("Kling API request failed");
  });

  it("rejects WebP before making a paid create request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new KlingProvider("key", fetchMock);
    await expect(
      provider.create({ sourceUrl: "https://storage.test/photo.webp", promptText: "Motion" }),
    ).rejects.toThrow("JPEG and PNG");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Kling configuration", () => {
  it("requires the Kling key only in real Kling mode", () => {
    expect(() =>
      testConfig({ USE_MOCK_RUNWAY: "false", VIDEO_PROVIDER: "kling", KLING_API_KEY: "" }),
    ).toThrow("KLING_API_KEY");

    const config = testConfig({
      USE_MOCK_RUNWAY: "false",
      VIDEO_PROVIDER: "kling",
      RUNWAYML_API_SECRET: "",
      KLING_API_KEY: "kling-key",
    });
    expect(config.videoProvider).toBe("kling");
    expect(config.klingApiKey).toBe("kling-key");
  });

  it("still supports the existing Runway configuration", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        TELEGRAM_BOT_TOKEN: "123:test-token",
        TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret_1234567890",
        RUNWAYML_API_SECRET: "runway-key",
        VIDEO_PROVIDER: "runway",
        USE_MOCK_RUNWAY: "false",
        DATABASE_URL: "postgresql://localhost/test",
        CRON_SECRET: "test-cron-secret-1234567890",
      }).runwayApiKey,
    ).toBe("runway-key");
  });
});
