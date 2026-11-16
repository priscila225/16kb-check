/**
 * Conservative list of well-known Java/Kotlin libraries that ship no native (.so) code.
 * Only used when a coordinate is not in the SDK database. Anything we are not sure about
 * stays "unknown" — this is not a compatibility claim about a specific version.
 */
type Rule = { group: string; artifact?: string | RegExp; reason: string };

const RULES: Rule[] = [
  { group: "org.jetbrains.kotlin", artifact: /^kotlin-stdlib/, reason: "Official Kotlin stdlib is JVM bytecode only." },
  { group: "org.jetbrains.kotlin", artifact: "kotlin-reflect", reason: "Official Kotlin reflect library is JVM bytecode only." },
  { group: "org.jetbrains.kotlinx", artifact: /^kotlinx-coroutines-/, reason: "kotlinx.coroutines Android/JVM artifacts contain no native libraries." },
  { group: "org.jetbrains.kotlinx", artifact: /^kotlinx-serialization-/, reason: "kotlinx.serialization artifacts are JVM/Android bytecode only." },
  { group: "org.jetbrains.kotlinx", artifact: "kotlinx-datetime", reason: "kotlinx-datetime Android artifact is JVM bytecode only." },
  { group: "org.jetbrains", artifact: "annotations", reason: "JetBrains annotation jar, no native code." },
  { group: "com.squareup.okhttp3", reason: "OkHttp is a pure-Java HTTP client." },
  { group: "com.squareup.okio", reason: "Okio is a pure-Java I/O library." },
  { group: "com.squareup.retrofit2", reason: "Retrofit is a pure-Java HTTP API layer." },
  { group: "com.squareup.moshi", reason: "Moshi is a pure-Java JSON library." },
  { group: "com.google.code.gson", artifact: "gson", reason: "Gson is a pure-Java JSON library." },
  { group: "com.jakewharton.timber", artifact: "timber", reason: "Timber is a pure-Java logging wrapper." },
  { group: "javax.inject", artifact: "javax.inject", reason: "JSR-330 annotations, no native code." },
  { group: "jakarta.inject", artifact: "jakarta.inject-api", reason: "Jakarta inject annotations, no native code." },
  { group: "com.google.dagger", artifact: /^dagger/, reason: "Dagger is a compile-time Java DI framework; the runtime is JVM bytecode." },
  { group: "com.google.dagger", artifact: /^hilt-/, reason: "Hilt is a Java DI layer on Dagger; the Android runtime has no native libraries." },
  { group: "androidx.annotation", reason: "AndroidX annotation libraries are Java-only." },
  { group: "androidx.core", artifact: /^core($|-)/, reason: "androidx.core is a Java/Kotlin Android library with no native .so in the AAR." },
  { group: "androidx.appcompat", reason: "AppCompat is a Java/Kotlin UI library with no native .so in the AAR." },
  { group: "androidx.fragment", reason: "AndroidX Fragment is Java/Kotlin only." },
  { group: "androidx.activity", reason: "AndroidX Activity is Java/Kotlin only." },
  { group: "androidx.lifecycle", reason: "AndroidX Lifecycle artifacts are Java/Kotlin only." },
  { group: "androidx.navigation", reason: "AndroidX Navigation artifacts are Java/Kotlin only." },
  { group: "androidx.recyclerview", reason: "RecyclerView is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.constraintlayout", reason: "ConstraintLayout is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.coordinatorlayout", reason: "CoordinatorLayout is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.drawerlayout", reason: "DrawerLayout is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.viewpager2", reason: "ViewPager2 is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.swiperefreshlayout", reason: "SwipeRefreshLayout is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.cardview", reason: "CardView is a Java/Kotlin UI library with no native .so." },
  { group: "androidx.preference", reason: "AndroidX Preference is Java/Kotlin only." },
  { group: "androidx.savedstate", reason: "SavedState is Java/Kotlin only." },
  { group: "androidx.startup", reason: "androidx.startup is Java/Kotlin only." },
  { group: "androidx.room", reason: "Room uses the framework SQLite; its AARs ship no native libraries." },
  { group: "androidx.work", reason: "WorkManager is a Java/Kotlin library with no native .so in the AAR." },
  { group: "androidx.datastore", reason: "DataStore is a Java/Kotlin library with no native .so." },
  { group: "androidx.paging", reason: "Paging is a Java/Kotlin library with no native .so." },
  { group: "com.google.android.material", artifact: "material", reason: "Material Components for Android is a Java/Kotlin UI library with no native .so." },
];

export function likelyFineReason(group: string, artifact: string): string | null {
  for (const r of RULES) {
    if (r.group !== group) continue;
    if (!r.artifact) return r.reason;
    if (typeof r.artifact === "string") {
      if (r.artifact === artifact) return r.reason;
    } else if (r.artifact.test(artifact)) {
      return r.reason;
    }
  }
  return null;
}
