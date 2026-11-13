import { InputFile, type Api } from "grammy";
import type { Store } from "./domain/store";
import type { AppConfig, Generation, StoredAsset } from "./domain/types";
import { downloadTelegramPhoto } from "./http";
import { validateImage } from "./images";
import { logError, logInfo } from "./logger";
import type { VideoProvider } from "./providers/types";
import type { SourceStorage } from "./storage";

export interface JobDependencies {
  config: AppConfig;
  store: Store;
  provider: VideoProvider;
  storage: SourceStorage;
  api: Api;
  configureApi?: (api: Api) => void;
  downloadPhoto?: typeof downloadTelegramPhoto;
}

export async function submitGeneration(
  id: string,
  deps: JobDependencies,
): Promise<void> {
  const generation = await deps.store.claimSubmission(
    id,
    deps.config.maxSubmissionAttempts,
  );
  if (!generation) return;

  let uploaded: StoredAsset | null = null;
  let providerCallStarted = false;
  let submitted = false;
  try {
    if (!generation.promptText) throw new Error("Prompt is missing.");
    const file = await deps.api.getFile(generation.telegramFileId);
    if (!file.file_path) throw new Error("Telegram file path is missing.");
    const download = deps.downloadPhoto ?? downloadTelegramPhoto;
    const bytes = await download(
      deps.config.telegramBotToken,
      file.file_path,
      deps.config.maxImageBytes,
    );
    const image = validateImage(bytes, deps.config.maxImageBytes);
    uploaded = await deps.storage.putSource(generation.id, bytes, image);
    await deps.store.attachSource(generation.id, uploaded);

    providerCallStarted = true;
    const task = await deps.provider.create({
      sourceUrl: uploaded.url,
      promptText: generation.promptText,
    });
    const saved = await deps.store.markSubmitted(generation.id, task.id);
    if (!saved) throw new Error("Could not save provider task ID.");
    submitted = true;
    logInfo("generation_submitted", { taskId: id });
  } catch {
    if (uploaded && !submitted) await deleteAsset(uploaded, deps, id);
    if (providerCallStarted || generation.attempts >= deps.config.maxSubmissionAttempts) {
      const failed = await deps.store.markFailed(id, "SUBMISSION_FAILED");
      if (failed) await notifyFailure(failed, deps);
    } else {
      await deps.store.requeueSubmission(id, "SUBMISSION_RETRY");
    }
    logError("generation_submission_failed", { taskId: id });
  }
}

export async function pollGeneration(id: string, deps: JobDependencies): Promise<void> {
  const generation = await deps.store.claimPoll(id, 60);
  if (!generation?.providerTaskId) return;

  let task;
  try {
    task = await deps.provider.retrieve(generation.providerTaskId);
  } catch {
    await deps.store.releasePoll(id);
    logError("provider_poll_retry", { taskId: id });
    return;
  }

  switch (task.status) {
    case "PENDING":
    case "THROTTLED":
    case "RUNNING":
      await deps.store.releasePoll(id);
      return;
    case "FAILED":
    case "CANCELLED": {
      const failed = await deps.store.markFailed(
        id,
        task.status === "FAILED" ? "PROVIDER_FAILED" : "PROVIDER_CANCELLED",
      );
      if (failed) {
        await notifyFailure(failed, deps);
        await deleteGenerationSource(failed, deps);
      }
      return;
    }
    case "SUCCEEDED": {
      const succeeded = await deps.store.markSucceeded(id, task.outputUrl);
      if (succeeded) await deliverResult(id, deps);
    }
  }
}

export async function deliverResult(id: string, deps: JobDependencies): Promise<void> {
  const generation = await deps.store.claimDelivery(id, 300);
  if (!generation?.resultUrl) return;

  try {
    const bytes = await deps.provider.downloadResult(
      generation.resultUrl,
      deps.config.maxVideoBytes,
    );
    await deps.api.sendVideo(
      generation.chatId,
      new InputFile(bytes, `animation-${generation.id}.mp4`),
      {
        caption: "Готово! Ваше ожившее видео — 5 секунд.",
        supports_streaming: true,
      },
    );
    const sent = await deps.store.markSent(id);
    if (!sent) throw new Error("Could not save delivery state.");
    logInfo("generation_sent", { taskId: id });
    await deleteGenerationSource(generation, deps);
  } catch {
    if (generation.sendAttempts >= 3) {
      const failed = await deps.store.markFailed(id, "DELIVERY_FAILED");
      if (failed) await notifyFailure(failed, deps);
    } else {
      await deps.store.releaseDelivery(id, "DELIVERY_RETRY");
    }
    logError("generation_delivery_failed", { taskId: id });
  }
}

async function readWithRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return read();
  }
}

export async function runWorker(deps: JobDependencies): Promise<{
  submitted: number;
  polled: number;
  delivered: number;
  cleaned: number;
}> {
  const interruptedBefore = new Date(
    Date.now() - deps.config.submissionStaleMinutes * 60_000,
  );
  const interrupted = await readWithRetry(() =>
    deps.store.listInterruptedUploads(interruptedBefore, deps.config.pollBatchSize),
  );
  for (const generation of interrupted) {
    const failed = await deps.store.markFailed(generation.id, "SUBMISSION_INTERRUPTED");
    if (failed) {
      await notifyFailure(failed, deps);
      await deleteGenerationSource(failed, deps);
    }
  }

  const confirmed = await readWithRetry(() =>
    deps.store.listConfirmed(deps.config.pollBatchSize),
  );
  for (const generation of confirmed) {
    await submitGeneration(generation.id, deps);
  }

  const pollable = await readWithRetry(() =>
    deps.store.listPollable(deps.config.pollBatchSize),
  );
  await Promise.all(pollable.map((generation) => pollGeneration(generation.id, deps)));

  const succeeded = await readWithRetry(() =>
    deps.store.listSucceeded(deps.config.pollBatchSize),
  );
  await Promise.all(succeeded.map((generation) => deliverResult(generation.id, deps)));

  const expired = await readWithRetry(() =>
    deps.store.listExpiredSources(deps.config.sourceTtlHours, deps.config.pollBatchSize),
  );
  let cleaned = 0;
  for (const generation of expired) {
    const asset = sourceAsset(generation);
    if (!asset) continue;
    try {
      await deps.storage.deleteSource(asset);
      await deps.store.clearSource(generation.id);
      cleaned += 1;
    } catch {
      logError("source_cleanup_retry", { taskId: generation.id });
    }
  }

  return {
    submitted: confirmed.length,
    polled: pollable.length,
    delivered: succeeded.length,
    cleaned,
  };
}

async function notifyFailure(generation: Generation, deps: JobDependencies): Promise<void> {
  try {
    await deps.api.sendMessage(
      generation.chatId,
      "Не удалось создать или отправить видео. Попробуйте новую фотографию позже. Состояние задачи доступно через /status.",
    );
  } catch {
    logError("failure_notification_failed", { taskId: generation.id });
  }
}

function sourceAsset(generation: Generation): StoredAsset | null {
  if (!generation.sourceUrl || !generation.sourcePathname) return null;
  return { url: generation.sourceUrl, pathname: generation.sourcePathname };
}

async function deleteGenerationSource(
  generation: Generation,
  deps: JobDependencies,
): Promise<void> {
  const asset = sourceAsset(generation);
  if (asset) await deleteAsset(asset, deps, generation.id);
}

async function deleteAsset(
  asset: StoredAsset,
  deps: JobDependencies,
  taskId: string,
): Promise<void> {
  try {
    await deps.storage.deleteSource(asset);
    const current = await deps.store.getGeneration(taskId);
    if (
      current?.sourceUrl === asset.url &&
      current.sourcePathname === asset.pathname
    ) {
      await deps.store.clearSource(taskId);
    }
  } catch {
    logError("source_delete_retry", { taskId });
  }
}
