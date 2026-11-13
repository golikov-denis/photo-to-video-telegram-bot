import type { GenerationStatus } from "./types";

const ACTIVE: readonly GenerationStatus[] = [
  "CONFIRMED",
  "UPLOADING",
  "SUBMITTED",
  "PROCESSING",
  "SUCCEEDED",
];

const TERMINAL: readonly GenerationStatus[] = ["SENT", "FAILED", "CANCELLED"];
const DRAFTS: readonly GenerationStatus[] = ["DRAFT", "WAITING_FOR_PROMPT"];

export function isActiveStatus(status: GenerationStatus): boolean {
  return ACTIVE.includes(status);
}

export function isTerminalStatus(status: GenerationStatus): boolean {
  return TERMINAL.includes(status);
}

export function isDraftStatus(status: GenerationStatus): boolean {
  return DRAFTS.includes(status);
}

export function canTransition(from: GenerationStatus, to: GenerationStatus): boolean {
  if (from === to) return true;
  if (isDraftStatus(from)) {
    return to === "CONFIRMED" || to === "CANCELLED" || isDraftStatus(to);
  }
  switch (from) {
    case "CONFIRMED":
      return to === "UPLOADING" || to === "FAILED";
    case "UPLOADING":
      return to === "CONFIRMED" || to === "SUBMITTED" || to === "FAILED";
    case "SUBMITTED":
      return to === "PROCESSING" || to === "FAILED" || to === "CANCELLED";
    case "PROCESSING":
      return to === "SUCCEEDED" || to === "FAILED" || to === "CANCELLED";
    case "SUCCEEDED":
      return to === "SENT" || to === "FAILED";
    case "SENT":
    case "FAILED":
    case "CANCELLED":
      return false;
    default:
      return false;
  }
}

export function statusText(status: GenerationStatus, provider = "Kling"): string {
  const labels: Record<GenerationStatus, string> = {
    DRAFT: "черновик: выберите эффект и подтвердите запуск",
    WAITING_FOR_PROMPT: "ожидается текстовое описание движения",
    CONFIRMED: `принята, подготавливается к отправке в ${provider}`,
    UPLOADING: "загружается исходная фотография",
    SUBMITTED: `передана в ${provider}`,
    PROCESSING: "генерируется видео",
    SUCCEEDED: "видео готово, отправляется в Telegram",
    SENT: "готово — видео отправлено",
    FAILED: "завершилась с ошибкой",
    CANCELLED: "отменена",
  };
  return labels[status];
}
