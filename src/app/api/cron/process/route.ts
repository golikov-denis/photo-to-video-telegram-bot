import { getConfig } from "@/lib/config";
import { runWorker } from "@/lib/jobs";
import { logError } from "@/lib/logger";
import { getJobDependencies } from "@/lib/runtime";
import { isAuthorizedCron } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const config = getConfig();
  if (!isAuthorizedCron(request.headers.get("authorization"), config.cronSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runWorker(getJobDependencies());
    return Response.json({ ok: true, ...result });
  } catch {
    logError("cron_worker_failed");
    return Response.json({ ok: false }, { status: 500 });
  }
}
