/**
 * Client-side filter for /check demand signals.
 * Private, internal, JitPack, and unknown groups stay on the device and are never sent.
 * The server still re-checks that each accepted name is published on Maven Central,
 * Google Maven, or the Gradle Plugin Portal before storing it.
 */

const COORD = /^[A-Za-z0-9_.-]{1,80}:[A-Za-z0-9_.-]{1,80}$/;

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
];

function hasAllowedPrefix(group: string): boolean {
  const g = group.toLowerCase();
  for (const prefix of PUBLIC_GROUP_PREFIXES) {
    if (g === prefix || g.startsWith(prefix + ".")) return true;
  }
  return false;
}

/** JitPack-style, example, or any group not on the known-public prefix list. */
export function isPrivateOrInternalGroup(group: string): boolean {
  const g = group.trim().toLowerCase();
  if (!g) return true;
  if (g === "com.github" || g.startsWith("com.github.")) return true;
  if (g === "io.jitpack" || g.startsWith("io.jitpack.") || g.includes("jitpack")) return true;
  if (g === "com.example" || g.startsWith("com.example.")) return true;
  return !hasAllowedPrefix(g);
}

/** True only for group:artifact names that may be sent as a demand signal. No versions. */
export function isCandidatePublicCoordinate(coordinate: string): boolean {
  const c = coordinate.trim();
  if (!COORD.test(c)) return false;
  const i = c.lastIndexOf(":");
  const group = c.slice(0, i);
  return !isPrivateOrInternalGroup(group);
}

export function publicDemandCoordinates(coordinates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of coordinates) {
    const c = raw.trim().toLowerCase();
    if (seen.has(c)) continue;
    if (!isCandidatePublicCoordinate(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= 40) break;
  }
  return out;
}
