/**
 * PostHog telemetry for `failproofai audit`.
 *
 * Plugs into the existing `trackHookEvent` surface (src/hooks/hook-telemetry.ts)
 * — same distinct ID strategy, same opt-out (`FAILPROOFAI_TELEMETRY_DISABLED=1`),
 * same fail-open contract (never crash the CLI).
 *
 * **Privacy contract — strictly enforced:**
 *   • Never send transcript paths, decoded project folder names, cwds,
 *     example command strings, file paths, sessionIds, or tool inputs.
 *   • Only ever send: policy/detector slugs (already public), counts,
 *     booleans, bucketed ages, CLI tags, output mode tags.
 *
 * Events fired during one `audit` run:
 *   1. `audit_started`           — once, before scanning
 *   2. `audit_pattern_detected`  — one per AuditCount aggregated
 *   3. `audit_install_cta_shown` — once, if there are unenabled builtins
 *   4. `audit_completed`         — once, at the end
 */
import { trackHookEvent } from "../hooks/hook-telemetry";
import { getInstanceId } from "../../lib/telemetry-id";
import type { AuditCount, AuditResult, RunAuditOptions } from "./types";

/** Bucketize an ISO timestamp into a coarse "days since" value to avoid
 *  shipping anything that could correlate with a specific session timing.
 *  Returns null when unknown. */
function ageBucketDays(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  // Bucket to nearest expected reporting horizon, never raw days
  if (days <= 0) return 0;
  if (days <= 1) return 1;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  if (days <= 90) return 90;
  if (days <= 365) return 365;
  return 366;
}

function shortName(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

/** Fire-and-forget — telemetry never blocks or fails the CLI. Promises are
 *  awaited inside trackHookEvent (which has a 5s AbortSignal); callers can
 *  `void` the return. */
export function trackAuditStarted(opts: RunAuditOptions, outputMode: string): void {
  void trackHookEvent(getInstanceId(), "audit_started", {
    clis_requested: opts.clis ?? "all",
    since_window: opts.since ?? null,
    has_project_filter: !!opts.projects?.length,
    has_policy_filter: !!opts.policies?.length,
    no_cache: !!opts.noCache,
    output_mode: outputMode,
  });
}

export function trackAuditPatternDetected(count: AuditCount): void {
  void trackHookEvent(getInstanceId(), "audit_pattern_detected", {
    pattern_name: shortName(count.name),
    pattern_source: count.source,
    pattern_category: count.category,
    hits: count.hits,
    projects: count.projects,
    enabled_in_config: count.enabledInConfig,
    severity: count.severity,
    first_seen_age_days: ageBucketDays(count.firstSeen),
    last_seen_age_days: ageBucketDays(count.lastSeen),
  });
}

export function trackAuditInstallCtaShown(unenabledNames: string[]): void {
  if (unenabledNames.length === 0) return;
  void trackHookEvent(getInstanceId(), "audit_install_cta_shown", {
    unenabled_count: unenabledNames.length,
    unenabled_pattern_names: unenabledNames.map(shortName),
  });
}

export function trackAuditCompleted(
  result: AuditResult,
  outputMode: string,
): void {
  const enabledHits = result.results
    .filter((r) => r.source === "builtin" && r.enabledInConfig)
    .reduce((acc, r) => acc + r.hits, 0);
  const unenabledHits = result.results
    .filter((r) => r.source === "builtin" && !r.enabledInConfig)
    .reduce((acc, r) => acc + r.hits, 0);
  const detectorHits = result.results
    .filter((r) => r.source === "audit-detector")
    .reduce((acc, r) => acc + r.hits, 0);

  void trackHookEvent(getInstanceId(), "audit_completed", {
    duration_ms: result.transcripts.durationMs,
    transcripts_scanned: result.transcripts.scanned,
    transcripts_skipped: result.transcripts.skipped,
    transcripts_errors: result.transcripts.errors,
    total_hits: result.totals.hits,
    projects_with_hits: result.totals.projectsWithHits,
    enabled_builtin_hits: enabledHits,
    unenabled_builtin_hits: unenabledHits,
    audit_detector_hits: detectorHits,
    result_count: result.results.length,
    clis_scanned: result.scope.cli,
    since_window: result.scope.since,
    has_project_filter: result.scope.projects !== "all",
    output_mode: outputMode,
  });
}
