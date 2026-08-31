/**
 * Shared constants for the report agent — safe to import from both client
 * and server code (no server-only deps here).
 *
 * The `GENERATE_REPORT_PREFIX` is the magic token the chat client prepends
 * to the user-message it sends when the user clicks "Generate Report" on
 * the report_plan canvas card. The router / orchestrator detect this
 * prefix to short-circuit into the report generator phase.
 */
export const GENERATE_REPORT_PREFIX = "__GENERATE_REPORT__";

export function isGenerateReportMessage(text: string): boolean {
  return text.trim().startsWith(GENERATE_REPORT_PREFIX);
}
