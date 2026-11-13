import { describe, expect, it } from "vitest";
import { startText } from "@/lib/telegram/messages";
import { testConfig } from "./helpers";

describe("user-facing start message", () => {
  it("explains the benefit and next action without technical pricing or resolution", () => {
    const text = startText(
      testConfig({
        USE_MOCK_RUNWAY: "false",
        VIDEO_PROVIDER: "kling",
        KLING_API_KEY: "test-key",
      }),
    );

    expect(text).toContain("Оживите свою фотографию");
    expect(text).toContain("естественным движением");
    expect(text).toContain("Видео длится 5 секунд");
    expect(text).toContain("JPEG и PNG");
    expect(text).toContain("Отправьте фотографию, чтобы начать");
    expect(text).not.toMatch(/720|Unit|кредит|руб|Kling|Runway|MOCK/i);
  });
});
