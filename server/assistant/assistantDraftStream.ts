import type { Response } from "express";

export function beginAssistantDraftNdjson(res: Response): void {
  if (res.headersSent) return;
  res.status(201);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function writeAssistantDraftNdjson(
  res: Response,
  event: Record<string, unknown>
): void {
  if (res.writableEnded) return;
  beginAssistantDraftNdjson(res);
  res.write(`${JSON.stringify(event)}\n`);
}
