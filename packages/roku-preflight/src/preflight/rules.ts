import { BUNDLED_ROKU_RULES, fmtDate, fmtDateRange } from "./roku-rules";

/**
 * Every rule a check enforces, with the official Roku page it comes from and the
 * devbooth.dev page that will explain it. Only dates read on official pages are used
 * (checked Nov 16, 2026).
 */
export const CHECK_IDS = [
  "manifest-required",
  "version",
  "rsg-version",
  "artwork",
  "package-size",
  "deep-linking",
  "deprecated-legacy-screens",
  "deprecated-apis",
  "launch-beacon",
  "memory-monitor",
  "raf",
  "roku-pay",
  "screensaver-manifest",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export type RuleMeta = { title: string; source: string; link: string };

const SITE = "https://devbooth.dev";

export const RULES: Record<CheckId, RuleMeta> = {
  "manifest-required": {
    title: "Manifest fields",
    source: "https://developer.roku.com/dev/docs/channel-manifest",
    link: `${SITE}/rules/roku-manifest`,
  },
  version: {
    title: "Version number",
    source: "https://developer.roku.com/dev/docs/certification",
    link: `${SITE}/rules/roku-version`,
  },
  "rsg-version": {
    title: "RSG version",
    source: "https://blog.roku.com/developer/rsg-1-3",
    link: `${SITE}/rules/roku-rsg-1-3`,
  },
  artwork: {
    title: "Icons and splash screens",
    source: "https://developer.roku.com/dev/docs/certification",
    link: `${SITE}/rules/roku-artwork`,
  },
  "package-size": {
    title: "Package size",
    source: "https://developer.roku.com/dev/docs/certification",
    link: `${SITE}/rules/roku-package-size`,
  },
  "deep-linking": {
    title: "Deep linking",
    source: "https://developer.roku.com/dev/docs/implementing-deep-linking",
    link: `${SITE}/rules/roku-deep-linking`,
  },
  "deprecated-legacy-screens": {
    title: "Legacy screens",
    source: "https://developer.roku.com/dev/docs/deprecated-apis",
    link: `${SITE}/rules/roku-deprecated-apis`,
  },
  "deprecated-apis": {
    title: "Deprecated APIs",
    source: "https://developer.roku.com/dev/docs/deprecated-apis",
    link: `${SITE}/rules/roku-deprecated-apis`,
  },
  "launch-beacon": {
    title: "Launch beacon",
    source: "https://developer.roku.com/dev/docs/measuring-channel-performance",
    link: `${SITE}/rules/roku-launch`,
  },
  "memory-monitor": {
    title: "Memory Monitor",
    source: "https://blog.roku.com/developer/integrate-brightscript-memory-monitor-apis",
    link: `${SITE}/rules/roku-memory-monitor`,
  },
  raf: {
    title: "Roku Advertising Framework",
    source: "https://developer.roku.com/dev/docs/ad-requirements",
    link: `${SITE}/rules/roku-raf`,
  },
  "roku-pay": {
    title: "Roku Pay",
    source: "https://developer.roku.com/dev/docs/roku-pay-requirements",
    link: `${SITE}/rules/roku-pay`,
  },
  "screensaver-manifest": {
    title: "Screensaver manifest",
    source: "https://developer.roku.com/dev/docs/channel-manifest",
    link: `${SITE}/rules/roku-screensaver`,
  },
};

const bundled = BUNDLED_ROKU_RULES.checks;

export const DATES = {
  rsgRequiredSince: bundled["rsg-version"].requiredSince,
  memoryMonitorSince: bundled["memory-monitor"].requiredSince,
  initClientCertWarningSince: bundled["init-client-certificates"].warningSince,
  initClientCertErrorFrom: bundled["init-client-certificates"].errorFrom,
} as const;

export { fmtDate, fmtDateRange };
