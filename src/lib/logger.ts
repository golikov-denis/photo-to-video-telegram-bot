type SafeLogFields = {
  taskId?: string;
  updateId?: number;
  status?: string;
  reason?: string;
};

export function logInfo(event: string, fields: SafeLogFields = {}): void {
  console.info(JSON.stringify({ level: "info", event, ...fields }));
}

export function logError(event: string, fields: SafeLogFields = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}
