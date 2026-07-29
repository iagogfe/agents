// In-process fallback for transcriptions whose Chatwoot write-back failed.
//
// The canonical store for a voice note's text is the Chatwoot attachment meta (`transcribed_text`),
// written by stt/service.ts and read back by chatwoot/messages.ts — the debounce flush re-fetches the
// conversation, so the direct in-memory value does not survive to the turn that answers. That PATCH
// route (`…/messages/:id/attachments/:id`) exists in the fazer.ai chatwoot fork; on UPSTREAM Chatwoot
// it 404s, and the transcription is silently lost (STT logs ok, the agent still sees "[audio]").
//
// This cache keeps the text keyed by Chatwoot message id so the re-fetch can recover it. Bounded and
// TTL'd because it holds customer speech (PII): entries die minutes after the turn that needs them.
//
// SINGLE PROCESS by construction — the same constraint the schedule/debounce/webhook workers already
// carry (docs/deploy.md: do NOT scale the app past one replica). With multiple web replicas a flush
// could land on a node without the entry; it degrades to today's behavior (untranscribed), never to
// wrong text. A durable fix belongs in the DB, alongside a fork/upstream write-back route.

import logger from "@/api/lib/logger";

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map<number, { text: string; at: number }>();

function evictExpired(now: number): void {
  for (const [id, entry] of cache) {
    if (now - entry.at > TTL_MS) cache.delete(id);
  }
}

export function rememberTranscription(messageId: number, text: string): void {
  if (!Number.isInteger(messageId) || messageId <= 0 || !text) return;
  const now = Date.now();
  evictExpired(now);
  // Oldest-first drop: the Map preserves insertion order, so the first key is the stalest.
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(messageId, { text, at: now });
}

export function recallTranscription(messageId: number): string | null {
  const entry = cache.get(messageId);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(messageId);
    return null;
  }
  logger.info(
    "stt: transcription recovered from the in-process cache (msg=%d)",
    messageId,
  );
  return entry.text;
}

// Tests only: drop every entry so cases do not leak into each other.
export function __clearTranscriptionCache(): void {
  cache.clear();
}
