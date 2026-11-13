export interface CreateVideoInput {
  sourceUrl: string;
  promptText: string;
}

export type ProviderTask =
  | { status: "PENDING" | "THROTTLED" | "RUNNING" }
  | { status: "SUCCEEDED"; outputUrl: string }
  | { status: "FAILED" | "CANCELLED" };

export interface VideoProvider {
  create(input: CreateVideoInput): Promise<{ id: string }>;
  retrieve(id: string): Promise<ProviderTask>;
  downloadResult(outputUrl: string, maxBytes: number): Promise<Buffer>;
}
