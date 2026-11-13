import { timingSafeEqual } from "node:crypto";

export function secretsEqual(received: string | null, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isAuthorizedTelegramWebhook(
  header: string | null,
  secret: string,
): boolean {
  return secretsEqual(header, secret);
}

export function isAuthorizedCron(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return secretsEqual(header.slice("Bearer ".length), secret);
}

export function isAdmin(userId: string, admins: ReadonlySet<string>): boolean {
  return admins.has(userId);
}
