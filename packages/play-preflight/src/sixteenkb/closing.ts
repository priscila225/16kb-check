export const NO_SUBMIT_LINE = "Downloaded the public SDK list. Sent no SDK names.";

export type Privacy = {
  offline: boolean;
  noSubmit?: boolean;
  lookedUp: boolean;
  skippedPrivate: number;
  /** Public SDK names actually POSTed to /api/check-demand. */
  submitted?: number;
  /** Public SDK names that would be posted in default online mode. */
  pendingUnknown?: number;
};

function skippedPrivateClause(n: number): string {
  if (!n) return "";
  return ` ${n} private or internal ${n === 1 ? "library was" : "libraries were"} skipped and never sent.`;
}

/** The last line of `check` and `16kb` text output (and stderr in `--json` for `16kb`). */
export function privacyLine(p: Privacy): string {
  if (p.offline) return "Checked fully offline. Nothing left this machine.";
  if (p.noSubmit && p.lookedUp) return NO_SUBMIT_LINE;
  if (p.lookedUp) {
    const sent = p.submitted ?? 0;
    if (sent > 0) {
      const noun = sent === 1 ? "name" : "names";
      return `Downloaded the public SDK list. Sent ${sent} unknown public SDK ${noun} to be checked.` + skippedPrivateClause(p.skippedPrivate);
    }
    if ((p.pendingUnknown ?? 0) === 0) {
      return "Downloaded the public SDK list. No unknown SDKs, so nothing was sent." + skippedPrivateClause(p.skippedPrivate);
    }
    // Catalog was downloaded, but unknowns were not posted (enqueue off or the POST failed).
    return NO_SUBMIT_LINE;
  }
  return "Checked locally. Nothing about your project was uploaded." + skippedPrivateClause(p.skippedPrivate);
}
