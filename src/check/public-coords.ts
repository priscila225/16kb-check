/**
 * Client-side filter for /check demand signals.
 * Private, internal, JitPack, and unknown groups stay on the device and are never sent.
 * The server still re-checks that each accepted name is published on Maven Central,
 * Google Maven, or the Gradle Plugin Portal before storing it.
 */

import { CATALOG_GROUPS } from "./catalog-groups";

const COORD = /^[A-Za-z0-9_.-]{1,80}:[A-Za-z0-9_.-]{1,80}$/;

/**
 * Exact groups that the public 16kb.dev catalog lists. Bundled at build time, and the CLI
 * adds the groups from the catalog it downloads before any privacy decision. Exact match only:
 * a listed group never makes its sub-groups or sibling groups public.
 */
const BUNDLED_CATALOG_GROUPS: ReadonlySet<string> = new Set(CATALOG_GROUPS);

/** Known public group prefixes: exact match, or prefix followed by a dot. */
const PUBLIC_GROUP_PREFIXES = [
  "androidx",
  "com.google",
  "com.android",
  "com.facebook",
  "com.squareup",
  "com.airbnb.android",
  "com.jakewharton",
  "com.braze",
  "com.amazon.android",
  "com.amazon.device",
  "com.adsbynimbus",
  "com.comscore",
  "com.davemorrissey.labs",
  "com.adevinta.android",
  "com.hyprmx.android",
  "com.chartboost",
  "com.vungle",
  "com.unity3d",
  "com.applovin",
  "com.twilio",
  "com.stripe",
  "com.adyen.checkout",
  "com.braintreepayments.api",
  "com.paypal",
  "com.onesignal",
  "com.appsflyer",
  "com.adjust.sdk",
  "com.mixpanel.android",
  "com.amplitude",
  "com.clevertap.android",
  "com.urbanairship.android",
  "com.revenuecat.purchases",
  "com.segment.analytics.android",
  "com.flurry.android",
  "com.kochava.tracker",
  "com.iterable",
  "com.launchdarkly",
  "com.statsig",
  "com.optimizely.ab",
  "com.fyber",
  "com.my.target",
  "com.yandex.android",
  "com.adcolony",
  "com.tencent",
  "com.instabug.library",
  "com.newrelic.agent.android",
  "com.dynatrace.agent",
  "com.opentok.android",
  "com.vonage",
  "com.mapbox",
  "com.sendbird.sdk",
  "com.criteo.publisher",
  "com.mparticle",
  "io.sentry",
  "io.branch.sdk.android",
  "io.realm",
  "io.agora",
  "io.getstream",
  "io.coil-kt",
  "io.objectbox",
  "io.livekit",
  "io.embrace",
  "io.intercom.android",
  "io.customer.android",
  "io.insert-koin",
  "io.ktor",
  "io.grpc",
  "io.reactivex",
  "io.flutter",
  "org.jetbrains",
  "org.apache",
  "org.chromium",
  "org.junit",
  "org.mockito",
  "org.robolectric",
  "org.hamcrest",
  "org.slf4j",
  "org.checkerframework",
  "org.conscrypt",
  "org.maplibre.gl",
  "org.videolan.android",
  "org.osmdroid",
  "org.opencv",
  "org.openpnp",
  "org.webkit",
  "net.zetetic",
  "net.java.dev.jna",
  "net.openid",
  "pl.droidsonroids.gif",
  "co.daily",
  "app.cash.sqldelight",
  "app.cash.turbine",
  "ly.count.android",
  "javax.inject",
  "jakarta.inject",
  "junit",
  "io.adapty",
  // Added after auditing every group in https://16kb.dev/api/catalog (Nov 2026).
  "com.arthenica",
  "com.auth0.android",
  "com.braintreepayments",
  "com.bugsnag",
  "com.couchbase.lite",
  "com.datadoghq",
  "com.ironsource.sdk",
  "com.journeyapps",
  "com.microsoft.onnxruntime",
  "io.github.webrtc-sdk",
  "org.pytorch",
  "org.tensorflow",
  "us.zoom.meetingsdk",
  "us.zoom.videosdk",
];

function hasAllowedPrefix(group: string): boolean {
  const g = group.toLowerCase();
  for (const prefix of PUBLIC_GROUP_PREFIXES) {
    if (g === prefix || g.startsWith(prefix + ".")) return true;
  }
  return false;
}

/** Groups that are always private, even if something claims otherwise. */
function isAlwaysPrivate(g: string): boolean {
  if (!g) return true;
  if (g === "io.jitpack" || g.startsWith("io.jitpack.") || g.includes("jitpack")) return true;
  if (g === "com.example" || g.startsWith("com.example.")) return true;
  return false;
}

/**
 * JitPack-style, example, or any group not on the known-public prefix list and not an exact
 * group from the 16kb.dev catalog. `catalogGroups` are exact groups from a downloaded catalog.
 */
export function isPrivateOrInternalGroup(group: string, catalogGroups?: ReadonlySet<string>): boolean {
  const g = group.trim().toLowerCase();
  if (isAlwaysPrivate(g)) return true;
  // Exact catalog groups are public (for example com.github.bumptech.glide), but only exact matches.
  if (BUNDLED_CATALOG_GROUPS.has(g) || catalogGroups?.has(g)) return false;
  if (g === "com.github" || g.startsWith("com.github.")) return true;
  return !hasAllowedPrefix(g);
}

/** True only for group:artifact names that may be sent as a demand signal. No versions. */
export function isCandidatePublicCoordinate(coordinate: string, catalogGroups?: ReadonlySet<string>): boolean {
  const c = coordinate.trim();
  if (!COORD.test(c)) return false;
  const i = c.lastIndexOf(":");
  const group = c.slice(0, i);
  return !isPrivateOrInternalGroup(group, catalogGroups);
}

/** Exact, lower-cased groups from catalog entries' Maven coordinates (wildcard groups are skipped). */
export function catalogGroupsFrom(entries: { mavenCoords?: string[] }[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    for (const c of e.mavenCoords || []) {
      const i = c.lastIndexOf(":");
      if (i <= 0) continue;
      const g = c.slice(0, i).trim().toLowerCase();
      if (!g || g.includes("*") || isAlwaysPrivate(g)) continue;
      out.add(g);
    }
  }
  return out;
}

export function publicDemandCoordinates(coordinates: string[], catalogGroups?: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of coordinates) {
    const c = raw.trim().toLowerCase();
    if (seen.has(c)) continue;
    if (!isCandidatePublicCoordinate(c, catalogGroups)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= 40) break;
  }
  return out;
}
