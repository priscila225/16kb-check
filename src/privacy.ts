import type { DeclaredDep } from "./check/types";
import { isCandidatePublicCoordinate, isPrivateOrInternalGroup } from "./check/public-coords";

export type PrivacySplit = {
  /** Coordinates that may be looked up or sent to 16kb.dev. */
  publicDeps: DeclaredDep[];
  /** How many declared libraries were dropped before any network call. */
  skippedPrivate: number;
};

/**
 * Drop anything that is not a verifiably public Maven coordinate.
 * Private and internal names never leave this process except as a count in the summary.
 */
export function splitPublicDeps(deps: DeclaredDep[]): PrivacySplit {
  const publicDeps: DeclaredDep[] = [];
  let skippedPrivate = 0;
  for (const d of deps) {
    const coordinate = `${d.group}:${d.artifact}`;
    if (isCandidatePublicCoordinate(coordinate) && !isPrivateOrInternalGroup(d.group)) {
      publicDeps.push(d);
    } else {
      skippedPrivate++;
    }
  }
  return { publicDeps, skippedPrivate };
}

/** Public group:artifact names only. No versions. Ready to send as a demand signal. */
export function demandCoordinatesFrom(deps: DeclaredDep[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of deps) {
    const c = `${d.group}:${d.artifact}`.toLowerCase();
    if (seen.has(c)) continue;
    if (!isCandidatePublicCoordinate(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= 40) break;
  }
  return out;
}
