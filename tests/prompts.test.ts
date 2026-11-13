import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  MAX_CUSTOM_PROMPT_LENGTH,
  normalizeCustomPrompt,
  PromptValidationError,
} from "@/lib/domain/prompts";

 describe("prompt construction", () => {
  it("builds fixed English prompts for both presets", () => {
    for (const effect of ["NATURAL", "CINEMATIC"] as const) {
      const prompt = buildPrompt(effect);
      expect(prompt).toContain("5-second video at 720p");
      expect(prompt).toContain("preserve the original people");
      expect(prompt).toContain("do not add people");
    }
    expect(buildPrompt("NATURAL")).toContain("gentle natural blinking");
    expect(buildPrompt("CINEMATIC")).toContain("smooth, slow camera push-in");
  });

  it("keeps mandatory constraints after custom user text", () => {
    const prompt = buildPrompt("CUSTOM", "Моргание и лёгкая улыбка");
    expect(prompt).toContain("Requested motion from the user: Моргание и лёгкая улыбка");
    expect(prompt.indexOf("Requested motion")).toBeLessThan(
      prompt.indexOf("Mandatory preservation constraints"),
    );
    expect(prompt).toContain("take priority over the request above");
  });

  it("normalizes whitespace and rejects invalid custom prompts", () => {
    expect(normalizeCustomPrompt("  лёгкое\n движение  ")).toBe("лёгкое движение");
    expect(() => normalizeCustomPrompt(" a ")).toThrow(PromptValidationError);
    expect(() => normalizeCustomPrompt("x".repeat(MAX_CUSTOM_PROMPT_LENGTH + 1))).toThrow(
      PromptValidationError,
    );
  });
});
