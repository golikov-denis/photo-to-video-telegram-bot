import type { Effect } from "./types";

export const MODEL_ID = "kling_4_flash" as const;
export const VIDEO_DURATION_SECONDS = 5 as const;
export const VIDEO_RATIO = "auto_720p" as const;
export const ESTIMATED_CREDITS = 47 as const;
export const MAX_CUSTOM_PROMPT_LENGTH = 1000;

const PRESERVATION_RULES = [
  "Mandatory preservation constraints, which take priority over the request above:",
  "preserve the original people, their exact identity, facial features, body proportions, clothing, background, and composition;",
  "animate only the requested motion; do not change appearance, age, ethnicity, or outfit;",
  "do not add people, objects, text, logos, cuts, scene changes, or new backgrounds;",
  "avoid face warping, extra limbs, flicker, abrupt deformation, and unrealistic physics.",
].join(" ");

const PRESET_PROMPTS: Record<Exclude<Effect, "CUSTOM">, string> = {
  NATURAL:
    "Create subtle, lifelike motion for a portrait or an ordinary photograph: gentle natural blinking, calm facial expressions, and slight movement of hair or clothing. Keep the camera and framing essentially still. The motion should be restrained and realistic.",
  CINEMATIC:
    "Create a cinematic but realistic animation with a smooth, slow camera push-in, gentle natural motion of the subjects and environment, coherent depth, and realistic physics. Avoid abrupt camera movement, dramatic reframing, and visual distortion.",
};

export class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptValidationError";
  }
}

export function normalizeCustomPrompt(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < 3) {
    throw new PromptValidationError("Опишите движение хотя бы тремя символами.");
  }
  if (normalized.length > MAX_CUSTOM_PROMPT_LENGTH) {
    throw new PromptValidationError(
      `Запрос слишком длинный. Максимум — ${MAX_CUSTOM_PROMPT_LENGTH} символов.`,
    );
  }
  return normalized;
}

export function buildPrompt(effect: Effect, customPrompt?: string): string {
  const request =
    effect === "CUSTOM"
      ? `Requested motion from the user: ${normalizeCustomPrompt(customPrompt ?? "")}`
      : PRESET_PROMPTS[effect];

  return [
    "Animate the supplied first frame into one continuous, realistic 5-second video at 720p.",
    request,
    PRESERVATION_RULES,
  ].join("\n\n");
}

export function effectTitle(effect: Effect): string {
  switch (effect) {
    case "NATURAL":
      return "Естественное движение";
    case "CINEMATIC":
      return "Кинематографичное оживление";
    case "CUSTOM":
      return "Свой запрос";
  }
}
