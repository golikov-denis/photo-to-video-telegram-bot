import { spawnSync } from "node:child_process";

const productionUrl = "https://22-08-59-afecda10.vercel.app";
const names = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_IDS",
  "VIDEO_PROVIDER",
  "RUNWAYML_API_SECRET",
  "KLING_API_KEY",
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
  "DAILY_GENERATION_LIMIT",
  "MAX_CONCURRENT_GENERATIONS",
  "RATE_LIMIT_REQUESTS",
  "RATE_LIMIT_WINDOW_SECONDS",
  "MAX_IMAGE_BYTES",
  "MAX_VIDEO_BYTES",
  "SOURCE_TTL_HOURS",
  "MAX_SUBMISSION_ATTEMPTS",
  "SUBMISSION_STALE_MINUTES",
  "POLL_BATCH_SIZE",
];

const values = Object.fromEntries(
  names
    .filter((name) => Boolean(process.env[name]))
    .map((name) => [name, process.env[name]]),
);
values.APP_BASE_URL = productionUrl;
values.GENERATIONS_ENABLED = "false";
values.USE_MOCK_RUNWAY = "false";
values.VIDEO_PROVIDER = "kling";

for (const [name, value] of Object.entries(values)) {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "--yes",
      "vercel",
      "env",
      "add",
      name,
      "--environment",
      "production",
      "--sensitive",
      "--force",
      "--yes",
    ],
    {
      input: `${value}\n`,
      encoding: "utf8",
      windowsHide: true,
      shell: process.platform === "win32",
      timeout: 60_000,
    },
  );
  if (result.status !== 0) {
    console.error(
      `Failed to save ${name}; exit code ${result.status ?? "none"}, error ${result.error?.code ?? "none"}.`,
    );
    process.exit(1);
  }
  console.log(`Saved ${name}`);
}

console.log(`Production environment synced: ${Object.keys(values).length} variables.`);
