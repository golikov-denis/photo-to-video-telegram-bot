import { Api } from "grammy";
import { getConfig } from "./config";
import { getPostgresStore } from "./db/postgres-store";
import type { JobDependencies } from "./jobs";
import { getVideoProvider } from "./providers";
import { createSourceStorage } from "./storage";

export function getJobDependencies(): JobDependencies {
  const config = getConfig();
  return {
    config,
    store: getPostgresStore(config.databaseUrl),
    provider: getVideoProvider(config),
    storage: createSourceStorage(config),
    api: new Api(config.telegramBotToken),
  };
}
