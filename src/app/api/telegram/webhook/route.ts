import { waitUntil } from "@vercel/functions";
import type { Update } from "grammy/types";
import { getConfig } from "@/lib/config";
import { logError } from "@/lib/logger";
import { getJobDependencies } from "@/lib/runtime";
import { isAuthorizedTelegramWebhook } from "@/lib/security";
import { processTelegramUpdate } from "@/lib/telegram/update";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  if (
    !isAuthorizedTelegramWebhook(
      request.headers.get("x-telegram-bot-api-secret-token"),
      config.telegramWebhookSecret,
    )
  ) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_000_000) return Response.json({ ok: false }, { status: 413 });

  let update: Update;
  try {
    const body = await request.text();
    if (body.length > 1_000_000) return Response.json({ ok: false }, { status: 413 });
    update = JSON.parse(body) as Update;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const result = await processTelegramUpdate(update, getJobDependencies());
    if (result.jobs.length > 0) {
      waitUntil(
        Promise.all(
          result.jobs.map((job) =>
            job().catch(() => logError("background_job_failed", { updateId: update.update_id })),
          ),
        ),
      );
    }
    return Response.json({ ok: true, duplicate: !result.handled });
  } catch {
    logError("webhook_processing_failed", { updateId: update.update_id });
    return Response.json({ ok: false }, { status: 500 });
  }
}
