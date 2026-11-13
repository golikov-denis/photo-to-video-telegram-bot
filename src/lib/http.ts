export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new DownloadError("File exceeds the size limit.");
  if (!response.body) throw new DownloadError("Response body is empty.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DownloadError("File exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function downloadBounded(
  url: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    allowedProtocols?: string[];
    fetchImpl?: typeof fetch;
  },
): Promise<Buffer> {
  const parsed = new URL(url);
  const allowed = options.allowedProtocols ?? ["https:"];
  if (!allowed.includes(parsed.protocol)) {
    throw new DownloadError("URL protocol is not allowed.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { "user-agent": "photo-video-bot/1.0" },
    });
  } catch {
    throw new DownloadError("Download failed.");
  }
  if (!response.ok) throw new DownloadError("Download returned an error.");
  return readLimited(response, options.maxBytes);
}

export async function downloadTelegramPhoto(
  botToken: string,
  filePath: string,
  maxBytes: number,
  fetchImpl?: typeof fetch,
): Promise<Buffer> {
  const encodedPath = filePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const url = `https://api.telegram.org/file/bot${botToken}/${encodedPath}`;
  return downloadBounded(url, {
    maxBytes,
    timeoutMs: 20_000,
    fetchImpl,
  });
}
