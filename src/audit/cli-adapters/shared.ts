/**
 * Shared helpers used by every per-CLI adapter.
 *
 * The lib/<cli>-sessions.ts parsers all produce the same `LogEntry[]` shape
 * (defined in lib/log-entries.ts), so the conversion from LogEntry[] to
 * NormalizedToolEvent[] is uniform across CLIs. The only per-CLI difference is
 * the canonicalization function, which we delegate to
 * `src/hooks/tool-name-canonicalize.ts`.
 */
import type { LogEntry } from "../../../lib/log-entries";
import type { IntegrationType } from "../../hooks/types";
import {
  canonicalizeToolName,
  canonicalizeToolInput,
} from "../../hooks/tool-name-canonicalize";
import {
  AUDIT_TOOL_RESULT_MAX_BYTES,
  type NormalizedToolEvent,
} from "../types";

/** Truncate a string to at most `maxBytes` UTF-8 bytes, preserving valid
 *  encoding (never splits a multi-byte sequence). `String.prototype.length`
 *  counts UTF-16 code units, not bytes — using it to "cap memory" would let
 *  through up to 4× the intended byte budget for non-ASCII text. */
function truncateToUtf8Bytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf-8");
  if (buf.byteLength <= maxBytes) return s;
  // Walk back at most 3 bytes to land on a UTF-8 boundary (a leading byte is
  // 0xxxxxxx or 11xxxxxx; continuation bytes are 10xxxxxx).
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}

export interface ConvertContext {
  cli: IntegrationType;
  sessionId: string;
  transcriptPath: string;
  /** Cwd resolved by the per-CLI parser. May be empty if the transcript had no
   *  session-start record. The audit falls back to the decoded project name. */
  cwd: string;
}

/** Walks the LogEntry[] in timestamp order and yields one NormalizedToolEvent
 *  per `tool_use` content block, with the matching `tool_result.content` text
 *  attached (truncated). Returns events in chronological order. */
export function logEntriesToEvents(
  entries: LogEntry[],
  ctx: ConvertContext,
): NormalizedToolEvent[] {
  const events: NormalizedToolEvent[] = [];

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message.content) {
      if (block.type !== "tool_use") continue;
      const rawName = block.name;
      const canonicalName = canonicalizeToolName(rawName, ctx.cli) ?? rawName;
      const canonicalInput = canonicalizeToolInput(
        canonicalName,
        block.input,
        ctx.cli,
      ) as Record<string, unknown>;

      let toolResultText: string | undefined;
      if (block.result?.content) {
        toolResultText = truncateToUtf8Bytes(block.result.content, AUDIT_TOOL_RESULT_MAX_BYTES);
      }

      events.push({
        cli: ctx.cli,
        sessionId: ctx.sessionId,
        transcriptPath: ctx.transcriptPath,
        cwd: ctx.cwd,
        timestamp: entry.timestamp,
        toolName: canonicalName,
        rawToolName: rawName,
        toolInput: canonicalInput ?? {},
        toolResultText,
      });
    }
  }

  return events;
}
