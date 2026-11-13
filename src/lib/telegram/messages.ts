import { InlineKeyboard } from "grammy";
import type { AppConfig } from "../domain/types";

export function providerName(config: AppConfig): string {
  if (config.useMockRunway) return "MOCK";
  return config.videoProvider === "kling" ? "Kling" : "Runway";
}

function supportedFormats(config: AppConfig): string {
  return !config.useMockRunway && config.videoProvider === "kling"
    ? "JPEG и PNG"
    : "JPEG, PNG и WebP";
}

export function startText(config: AppConfig): string {
  return [
    "✨ Оживите свою фотографию!",
    "",
    "Превратите снимок в короткое видео с естественным движением — люди, животные и предметы на фото будто оживают.",
    "",
    "Как это работает:",
    "1. Отправьте фотографию.",
    "2. Выберите готовый эффект или опишите желаемое движение своими словами.",
    "3. Дождитесь готового видео — оно придёт прямо сюда, в чат.",
    "",
    "Видео длится 5 секунд. Обычно создание занимает несколько минут.",
    `Подойдёт фото ${supportedFormats(config)} до 10 МБ.`,
    "",
    "📸 Отправьте фотографию, чтобы начать!",
  ].join("\n");
}

export function helpText(config: AppConfig): string {
  return [
    `Подойдёт чёткая фотография без сильного размытия, с видимым лицом и исходным фоном. Поддерживаются ${supportedFormats(config)} до 10 МБ. GIF и другие форматы не принимаются.`,
    "",
    "В своём запросе опишите только желаемое движение, например: «человек слегка улыбается, волосы движутся от лёгкого ветра». Максимум — 1000 символов. После отправки описания создание видео начнётся автоматически.",
    "",
    "Базовые ограничения всегда сохраняют людей, внешность, пропорции тела, одежду, фон и композицию. Модель не гарантирует идеального результата.",
    "",
    "Команды: /start, /help, /status, /cancel, /privacy.",
  ].join("\n");
}

export function privacyText(config: AppConfig): string {
  const provider = providerName(config);
  return [
    `Фотография скачивается из Telegram и временно помещается в отдельное хранилище, чтобы ${provider} мог получить её по HTTPS без токена бота.`,
    "",
    `Исходник удаляется после завершения задачи или автоматически по TTL (по умолчанию — 24 часа). Ссылки на результат ${provider} временные. Видео передаётся в Telegram как файл и не публикуется ботом на постоянной странице.`,
    "",
    `Удаление наших временных копий не гарантирует удаление данных из журналов, резервных копий или по правилам хранения Telegram и ${provider}. Не отправляйте фотографии без согласия изображённых людей.`,
  ].join("\n");
}

export const GENERIC_ERROR_TEXT =
  "Не удалось выполнить генерацию. Попробуйте ещё раз позже или отправьте новую фотографию.";

export function effectKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Естественное движение", "effect:NATURAL")
    .row()
    .text("Кинематографичное оживление", "effect:CINEMATIC")
    .row()
    .text("Свой запрос", "effect:CUSTOM")
    .row()
    .text("Отмена", "draft:cancel");
}
