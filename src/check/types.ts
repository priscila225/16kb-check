export type Status = "compatible" | "partial" | "not-yet" | "checking" | "needs-review" | "unknown";

export type DeclaredDep = {
  group: string;
  artifact: string;
  /** Raw version string if one was declared. Empty if the version comes from a BOM or catalog and could not be resolved. */
  version: string;
  /** How the version was obtained, for the report. */
  versionSource: "declared" | "catalog" | "variable" | "bom" | "missing";
  configuration: string;
  /** Catalog alias (e.g. androidx-core-ktx) if this came from libs.* */
  catalogAlias?: string;
  /** BOM coordinate when the version is managed by a platform() / BOM. */
  bom?: string;
  sourceFile: string;
  /** Declared only for tests (test, androidTest, testFixtures, or a known test framework). */
  testOnly?: boolean;
};

export type ParseIssue = {
  file: string;
  message: string;
};

export type ParseResult = {
  /** Release dependencies: what ships in the app. No plugins, no test-only libraries. */
  dependencies: DeclaredDep[];
  /** Gradle plugins (plugins {}, apply plugin, catalog [plugins], buildscript classpath AGP). */
  plugins: DeclaredDep[];
  /** Test-only dependencies, kept out of readiness counts. */
  testDependencies: DeclaredDep[];
  boms: { group: string; artifact: string; version: string; sourceFile: string }[];
  files: { name: string; kind: "toml" | "gradle" | "unknown"; depCount: number }[];
  issues: ParseIssue[];
};

export type ReportVerdict =
  | "compatible"
  | "update-needed"
  | "not-yet"
  | "partial"
  | "checking"
  | "needs-review"
  | "unknown"
  | "likely-fine";

export type ReportRow = {
  group: string;
  artifact: string;
  coordinate: string;
  declaredVersion: string;
  versionSource: DeclaredDep["versionSource"];
  configuration: string;
  sourceFile: string;
  catalogAlias?: string;
  bom?: string;
  verdict: ReportVerdict;
  /** Short explanation shown in the row. */
  detail: string;
  entry?: Pick<CatalogEntry, "slug" | "name" | "status" | "minVersion" | "notes">;
  /** True when this is a well-known JVM-only library with no native code we know of. */
  likelyFineReason?: string;
};

export type CheckReport = {
  rows: ReportRow[];
  counts: Record<ReportVerdict, number>;
  /** Libraries that may block a Feb 1, 2027 Play release. */
  blocking: number;
  verdictLine: string;
  notes: string[];
  files: ParseResult["files"];
  issues: ParseIssue[];
  unmatchedCoordinates: string[];
};

export type CatalogLibrary = {
  alias: string;
  group: string;
  artifact: string;
  version?: string;
  versionRef?: string;
};

export type VersionCatalog = {
  versions: Record<string, string>;
  libraries: Record<string, CatalogLibrary>;
  plugins: Record<string, { id: string; version?: string; versionRef?: string }>;
  bundles: Record<string, string[]>;
};

export const REPORT_VERDICTS: ReportVerdict[] = [
  "compatible",
  "update-needed",
  "not-yet",
  "partial",
  "checking",
  "needs-review",
  "unknown",
  "likely-fine",
];

export const REPORT_LABEL: Record<ReportVerdict, string> = {
  compatible: "Compatible",
  "update-needed": "Update needed",
  "not-yet": "Not yet",
  partial: "Partial",
  checking: "Checking...",
  "needs-review": "Needs review",
  unknown: "Unknown",
  "likely-fine": "Likely fine (no native code known)",
};

export type CatalogEntry = {
  slug: string;
  name: string;
  status: Status;
  minVersion: string;
  notes: string;
  mavenCoords: string[];
  autoChecked?: boolean;
};
