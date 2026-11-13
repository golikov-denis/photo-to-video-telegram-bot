import type { Update } from "grammy/types";
import { createTelegramBot } from "./bot";
import { submitGeneration, type JobDependencies } from "../jobs";

export type BackgroundJob = () => Promise<void>;

export async function processTelegramUpdate(
  update: Update,
  deps: JobDependencies,
): Promise<{ handled: boolean; jobs: BackgroundJob[] }> {
  const jobs: BackgroundJob[] = [];
  let claimed = false;

  await deps.store.transaction(async (transaction) => {
    claimed = await transaction.claimUpdate(update.update_id);
    if (!claimed) return;
    const bot = createTelegramBot({
      config: deps.config,
      store: transaction,
      configureApi: deps.configureApi,
      onConfirmed: (id) => {
        jobs.push(() => submitGeneration(id, deps));
      },
    });
    await bot.handleUpdate(update);
  });

  return { handled: claimed, jobs };
}
