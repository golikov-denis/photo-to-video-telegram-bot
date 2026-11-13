import { randomUUID } from "node:crypto";
import { Bot, type Context } from "grammy";
import type { Store } from "../domain/store";
import { buildPrompt, PromptValidationError } from "../domain/prompts";
import { isDraftStatus, statusText } from "../domain/status";
import { GENERATION_STATUSES } from "../domain/types";
import type { AppConfig, Effect, Generation } from "../domain/types";
import { isAdmin } from "../security";
import {
  effectKeyboard,
  GENERIC_ERROR_TEXT,
  helpText,
  privacyText,
  providerName,
  startText,
} from "./messages";

interface BotDependencies {
  config: AppConfig;
  store: Store;
  onConfirmed: (generationId: string) => void;
  configureApi?: (api: Bot["api"]) => void;
}

export function createTelegramBot(deps: BotDependencies): Bot {
  const { config, store } = deps;
  const bot = new Bot(config.telegramBotToken, {
    botInfo: {
      id: 0,
      is_bot: true,
      first_name: "PhotoVideoBot",
      username: "photo_video_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });
  deps.configureApi?.(bot.api);

  bot.catch((error) => {
    throw error.error;
  });

  bot.use(async (ctx, next) => {
    const user = ctx.from;
    const chat = ctx.chat;
    if (!user || !chat) return next();
    const userId = String(user.id);
    await store.upsertUser(userId, String(chat.id));
    const allowed = await store.consumeRateLimit(
      userId,
      config.rateLimitRequests,
      config.rateLimitWindowSeconds,
      new Date(),
    );
    if (!allowed) {
      await ctx.reply("Слишком много запросов. Подождите минуту и попробуйте снова.");
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(startText(config));
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(config));
  });

  bot.command("privacy", async (ctx) => {
    await ctx.reply(privacyText(config));
  });

  bot.command("status", async (ctx) => {
    const generation = await store.getLatestGeneration(String(ctx.from!.id));
    if (!generation) {
      await ctx.reply("У вас пока нет задач. Отправьте фотографию, чтобы начать.");
      return;
    }
    const error = generation.status === "FAILED" ? `\n${GENERIC_ERROR_TEXT}` : "";
    await ctx.reply(
      `Статус последнего запроса: ${statusText(generation.status, providerName(config))}.${error}`,
    );
  });

  bot.command("cancel", async (ctx) => {
    await cancelCurrentDraft(ctx, store);
  });

  bot.command("stats", async (ctx) => {
    if (!isAdmin(String(ctx.from!.id), config.telegramAdminIds)) {
      await ctx.reply("Эта команда недоступна.");
      return;
    }
    const stats = await store.getStats();
    const lines = GENERATION_STATUSES.map(
      (status) => `${status}: ${stats.byStatus[status] ?? 0}`,
    );
    await ctx.reply(`Пользователей: ${stats.users}\n\n${lines.join("\n")}`);
  });

  bot.on("message:photo", async (ctx) => {
    const photo = ctx.message.photo.at(-1);
    if (!photo) return;
    await createDraft(ctx, store, config, {
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      fileSize: photo.file_size ?? null,
    });
  });

  bot.on("message:document", async (ctx) => {
    const document = ctx.message.document;
    const klingRealMode = !config.useMockRunway && config.videoProvider === "kling";
    const allowedTypes = klingRealMode
      ? ["image/jpeg", "image/png"]
      : ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(document.mime_type ?? "")) {
      await ctx.reply(
        klingRealMode
          ? "Kling принимает только JPEG и PNG. Отправьте фотографию в одном из этих форматов."
          : "Отправьте изображение JPEG, PNG или WebP. Другие файлы не поддерживаются.",
      );
      return;
    }
    await createDraft(ctx, store, config, {
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
      fileSize: document.file_size ?? null,
    });
  });

  bot.callbackQuery(/^effect:(NATURAL|CINEMATIC|CUSTOM)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const effect = ctx.match[1] as Effect;
    const current = await store.getCurrentGeneration(String(ctx.from!.id));
    if (!current || !isDraftStatus(current.status)) {
      await ctx.reply("Сначала отправьте новую фотографию.");
      return;
    }
    const generation = await store.setEffect(
      current.id,
      String(ctx.from!.id),
      effect,
      effect === "CUSTOM" ? "WAITING_FOR_PROMPT" : "DRAFT",
      effect === "CUSTOM" ? null : buildPrompt(effect),
    );
    if (!generation) {
      await ctx.reply("Этот черновик уже недоступен. Отправьте фотографию заново.");
      return;
    }
    if (effect === "CUSTOM") {
      await ctx.editMessageReplyMarkup();
      await ctx.reply(
        "Опишите одним сообщением, как должна двигаться фотография. Например: «человек слегка улыбается, волосы движутся от лёгкого ветра». После отправки описания создание видео начнётся автоматически.",
      );
      return;
    }
    await confirmDraft(ctx, generation, deps, true);
  });

  // Supports confirmation buttons left in chats before the shorter flow was deployed.
  bot.callbackQuery("draft:confirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    const current = await store.getCurrentGeneration(String(ctx.from!.id));
    if (!current) {
      await ctx.reply("Черновик не найден. Отправьте новую фотографию.");
      return;
    }
    await confirmDraft(ctx, current, deps, true);
  });

  bot.callbackQuery("draft:cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Черновик отменён");
    await cancelCurrentDraft(ctx, store);
  });

  bot.on("message:text", async (ctx) => {
    const current = await store.getCurrentGeneration(String(ctx.from!.id));
    if (current?.status !== "WAITING_FOR_PROMPT" || current.effect !== "CUSTOM") {
      await ctx.reply("Отправьте фотографию или используйте /help для инструкции.");
      return;
    }
    try {
      const promptText = buildPrompt("CUSTOM", ctx.message.text);
      const generation = await store.setCustomPrompt(
        current.id,
        String(ctx.from!.id),
        ctx.message.text.normalize("NFKC").replace(/\s+/g, " ").trim(),
        promptText,
      );
      if (!generation) {
        await ctx.reply("Черновик уже недоступен. Отправьте фотографию заново.");
        return;
      }
      const started = await confirmDraft(ctx, generation, deps, false);
      if (!started) {
        await store.setEffect(
          generation.id,
          String(ctx.from!.id),
          "CUSTOM",
          "WAITING_FOR_PROMPT",
          null,
        );
      }
    } catch (error) {
      if (error instanceof PromptValidationError) {
        await ctx.reply(error.message);
        return;
      }
      throw error;
    }
  });

  bot.on("message", async (ctx) => {
    await ctx.reply("Отправьте подходящую фотографию. Форматы и ограничения указаны в /help.");
  });

  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery("Действие недоступно");
  });

  return bot;
}

async function createDraft(
  ctx: Context,
  store: Store,
  config: AppConfig,
  file: { fileId: string; fileUniqueId: string; fileSize: number | null },
): Promise<void> {
  if (file.fileSize && file.fileSize > config.maxImageBytes) {
    await ctx.reply("Фотография слишком большая. Максимальный размер — 10 МБ.");
    return;
  }
  await store.createDraft({
    id: randomUUID(),
    userId: String(ctx.from!.id),
    chatId: String(ctx.chat!.id),
    telegramFileId: file.fileId,
    telegramFileUniqueId: file.fileUniqueId,
    declaredFileSize: file.fileSize,
  });
  await ctx.reply("Фотография принята! Выберите эффект — создание видео начнётся автоматически:", {
    reply_markup: effectKeyboard(),
  });
}

async function confirmDraft(
  ctx: Context,
  generation: Generation,
  deps: BotDependencies,
  removeKeyboard: boolean,
): Promise<boolean> {
  const { config, store } = deps;
  const result = await store.confirmGeneration(
    generation.id,
    String(ctx.from!.id),
    config.dailyGenerationLimit,
    config.maxConcurrentGenerations,
    config.generationsEnabled,
  );
  if (result.kind !== "ok") {
    const messages = {
      disabled: "Создание видео временно недоступно. Попробуйте позже.",
      daily_limit: "Дневной лимит видео исчерпан. Попробуйте завтра.",
      concurrency_limit: "Сейчас создаётся максимум видео. Попробуйте ещё раз через минуту.",
      not_ready: "Этот запрос уже обработан. Проверьте /status или отправьте новую фотографию.",
    } as const;
    await ctx.reply(messages[result.kind]);
    return false;
  }
  if (removeKeyboard) await ctx.editMessageReplyMarkup();
  await ctx.reply(
    "Принято! Создаю видео. Обычно это занимает несколько минут — пришлю его сюда, как только оно будет готово.",
  );
  deps.onConfirmed(result.generation.id);
  return true;
}

async function cancelCurrentDraft(ctx: Context, store: Store): Promise<void> {
  const current = await store.getCurrentGeneration(String(ctx.from!.id));
  if (!current || !isDraftStatus(current.status)) {
    await ctx.reply("Нет активного черновика. Запущенную генерацию отменить через бота нельзя.");
    return;
  }
  await store.cancelDraft(current.id, String(ctx.from!.id));
  await ctx.reply("Черновик отменён. Можно отправить новую фотографию.");
}
