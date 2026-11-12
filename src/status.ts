import type { ReportVerdict } from "./check/types";

/** Status labels shown in the CLI table. */
export type CliStatus = "ready" | "not ready" | "partial" | "checking" | "unknown";

export function toCliStatus(verdict: ReportVerdict): CliStatus {
  switch (verdict) {
    case "compatible":
    case "likely-fine":
      return "ready";
    case "update-needed":
    case "not-yet":
      return "not ready";
    case "partial":
      return "partial";
    case "checking":
      return "checking";
    default:
      return "unknown";
  }
}

/**
 * Matches the Google Play compatibility requirement on
 * https://developer.android.com/guide/practices/page-sizes (checked Nov 11, 2026).
 */
export const DEADLINE_NOTE =
  "Google Play: apps targeting Android 15 (API 35) or higher must support 16 KB page sizes on 64-bit devices. Starting Feb 1, 2027, updates that don't support 16 KB can't be released.";

export const DEADLINE_SOURCE = "https://developer.android.com/guide/practices/page-sizes";

export const SCOPE_NOTE =
  "This is a dependency-level check. Tip: verify the built APK with `zipalign -c -P 16 -v 4 app.apk` or Android Studio's APK Analyzer.";

export const SETTLING_NOTE =
  "Results are still settling: 16kb.dev is still checking some libraries, so counts can change between runs. Re-run in a few minutes.";
