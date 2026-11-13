const apiKey = process.env.CRONJOB_API_KEY;
const cronSecret = process.env.CRON_SECRET;
const targetUrl = "https://22-08-59-afecda10.vercel.app/api/cron/process";

if (!apiKey || !cronSecret) {
  throw new Error("CRONJOB_API_KEY and CRON_SECRET must be filled.");
}

async function request(path, options = {}) {
  const response = await fetch(`https://api.cron-job.org${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`cron-job.org HTTP ${response.status}: ${body.message ?? "request failed"}`);
  }
  return body;
}

const settings = {
  url: targetUrl,
  title: "Photo Video Bot — production worker",
  enabled: true,
  saveResponses: false,
  requestMethod: 0,
  requestTimeout: 60,
  schedule: {
    timezone: "UTC",
    expiresAt: 0,
    hours: [-1],
    mdays: [-1],
    minutes: [-1],
    months: [-1],
    wdays: [-1],
  },
  extendedData: {
    headers: { Authorization: `Bearer ${cronSecret}` },
    body: "",
  },
};

const list = await request("/jobs");
if (list.someFailed) throw new Error("cron-job.org returned an incomplete job list.");
const matching = (list.jobs ?? []).filter((job) => job.url === targetUrl);
if (matching.length > 1) throw new Error("Multiple matching jobs already exist; no changes made.");

let jobId;
if (matching.length === 1) {
  jobId = matching[0].jobId;
  await request(`/jobs/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify({ job: settings }),
  });
} else {
  const created = await request("/jobs", {
    method: "PUT",
    body: JSON.stringify({ job: settings }),
  });
  jobId = created.jobId;
}

if (!Number.isInteger(jobId)) throw new Error("cron-job.org did not return a job ID.");
const details = (await request(`/jobs/${jobId}`)).jobDetails;
console.log(JSON.stringify({
  jobId,
  title: details.title,
  enabled: details.enabled,
  method: details.requestMethod === 0 ? "GET" : details.requestMethod,
  everyMinute: details.schedule?.minutes?.length === 1 && details.schedule.minutes[0] === -1,
  timezone: details.schedule?.timezone,
  authorizationHeaderSaved: Boolean(details.extendedData?.headers?.Authorization),
  nextExecutionUtc: details.nextExecution
    ? new Date(details.nextExecution * 1000).toISOString()
    : null,
}));
