const action = process.argv[2] ?? "set";
const token = process.env.TELEGRAM_BOT_TOKEN;
const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required in .env");
if (!["set", "info", "delete"].includes(action)) {
  throw new Error("Usage: telegram-webhook.mjs set|info|delete");
}

const method = action === "set" ? "setWebhook" : action === "info" ? "getWebhookInfo" : "deleteWebhook";
const payload = action === "set"
  ? {
      url: `${baseUrl}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    }
  : {};

if (action === "set") {
  if (!baseUrl || !secret) throw new Error("APP_BASE_URL and TELEGRAM_WEBHOOK_SECRET are required");
  if (!baseUrl.startsWith("https://")) throw new Error("APP_BASE_URL must use HTTPS");
}

const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(20_000),
});
const result = await response.json();
if (!response.ok || !result.ok) {
  const description = String(result.description ?? "Telegram API error").replaceAll(token, "[hidden]");
  throw new Error(description);
}
console.log(action === "info" ? JSON.stringify(result.result, null, 2) : `Webhook ${action}: OK`);
