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

export const DEADLINE_NOTE =
  "Google Play blocks updates targeting API 35+ without 16KB support from Feb 1, 2027.";
