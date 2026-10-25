import { managementURL } from "./client";
import { currentKey } from "@/stores/auth";
import type { RequestRecord } from "./types";

export interface SSEHandlers {
  onOpen?: () => void;
  onBacklog?: (records: RequestRecord[]) => void;
  onRequest?: (record: RequestRecord) => void;
  /** Stream ended (server closed, dropped, or network error); not called on abort. */
  onEnd?: (error?: unknown) => void;
}

interface SSEFrame {
  event: string;
  data: string;
}

/**
 * Consume a server-sent-events endpoint that requires the Authorization
 * header (EventSource cannot send headers). Resolves when the stream ends.
 */
export async function consumeSSE(path: string, handlers: SSEHandlers, signal: AbortSignal): Promise<void> {
  let buffer = "";
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(managementURL(path), {
      headers: { Authorization: `Bearer ${currentKey()}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const message = await response.text().catch(() => "");
      throw new Error(`SSE ${response.status}${message ? `: ${message.slice(0, 200)}` : ""}`);
    }
    handlers.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame) dispatchFrame(frame, handlers);
        boundary = buffer.indexOf("\n\n");
      }
    }
    handlers.onEnd?.();
  } catch (error) {
    if (signal.aborted || controller.signal.aborted) return;
    handlers.onEnd?.(error);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function parseFrame(chunk: string): SSEFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith(":")) continue; // heartbeat comment
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function dispatchFrame(frame: SSEFrame, handlers: SSEHandlers) {
  try {
    const payload = JSON.parse(frame.data) as unknown;
    if (frame.event === "backlog") {
      const records = (payload as { records?: RequestRecord[] }).records ?? [];
      handlers.onBacklog?.(records);
    } else if (frame.event === "request") {
      handlers.onRequest?.(payload as RequestRecord);
    }
  } catch {
    // Malformed frame; skip it.
  }
}
