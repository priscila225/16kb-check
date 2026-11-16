/**
 * Every rule a check enforces, with the official Google page it comes from and the devbooth.dev page
 * that explains it. Only dates read on the official pages are used (checked Nov 16, 2026).
 * The API 37 target date isn't announced, so it's deliberately not here.
 */
export const CHECK_IDS = [
  "target-api",
  "16kb",
  "play-billing",
  "foreground-services",
  "edge-to-edge",
  "large-screens",
  "predictive-back",
  "photo-video",
  "exact-alarms",
  "restricted-permissions",
  "account-deletion",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export type RuleMeta = { title: string; source: string; link: string };

const SITE = "https://devbooth.dev";

export const RULES: Record<CheckId, RuleMeta> = {
  "target-api": {
    title: "Target API level",
    source: "https://support.google.com/googleplay/android-developer/answer/11926878",
    link: `${SITE}/rules/play-target-api`,
  },
  "16kb": {
    title: "16 KB page size",
    source: "https://developer.android.com/guide/practices/page-sizes",
    link: `${SITE}/deadlines/play-16kb`,
  },
  "play-billing": {
    title: "Play Billing Library",
    source: "https://developer.android.com/google/play/billing/deprecation-faq",
    link: `${SITE}/deadlines/play-billing-9`,
  },
  "foreground-services": {
    title: "Foreground services",
    source: "https://developer.android.com/about/versions/14/changes/fgs-types-required",
    link: `${SITE}/rules/foreground-service-types`,
  },
  "edge-to-edge": {
    title: "Edge to edge",
    source: "https://developer.android.com/about/versions/16/behavior-changes-16",
    link: `${SITE}/rules/edge-to-edge`,
  },
  "large-screens": {
    title: "Large screens",
    source: "https://developer.android.com/about/versions/16/behavior-changes-16",
    link: `${SITE}/rules/large-screens-orientation`,
  },
  "predictive-back": {
    title: "Predictive back",
    source: "https://developer.android.com/about/versions/16/behavior-changes-16",
    link: `${SITE}/rules/predictive-back`,
  },
  "photo-video": {
    title: "Photo & video access",
    source: "https://support.google.com/googleplay/android-developer/answer/14115180",
    link: `${SITE}/rules/photo-video-permissions`,
  },
  "exact-alarms": {
    title: "Exact alarms",
    source: "https://support.google.com/googleplay/android-developer/answer/13161072",
    link: `${SITE}/rules/exact-alarms`,
  },
  "restricted-permissions": {
    title: "Restricted permissions",
    source: "https://support.google.com/googleplay/android-developer/answer/13161072",
    link: `${SITE}/deadlines/play-permissions`,
  },
  "account-deletion": {
    title: "Account deletion",
    source: "https://support.google.com/googleplay/android-developer/answer/13327111",
    link: `${SITE}/rules/account-deletion`,
  },
};

/** Verified dates (ISO). */
export const DATES = {
  targetApi36: "2026-08-31",
  targetApi36Extension: "2026-11-01",
  sixteenKbBlock: "2027-02-01",
  billing7Cutoff: "2026-08-31",
  billing7Extension: "2026-11-01",
  billing8Cutoff: "2027-08-31",
  billing8Extension: "2027-11-01",
  billing9Cutoff: "2028-08-31",
  permissionsApi37: "2027-01-27",
  localNetworkApi37: "2027-08-25",
} as const;

/** Play's minimum targetSdk for new apps and updates, by form factor (since Aug 31, 2026). */
export const PLAY_MIN_TARGET = { phone: 36, wear: 35, automotive: 35, tv: 34 } as const;
export type FormFactor = keyof typeof PLAY_MIN_TARGET;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
