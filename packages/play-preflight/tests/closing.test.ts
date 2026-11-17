import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_SUBMIT_LINE, privacyLine } from "../src/sixteenkb/closing.ts";

test("NO_SUBMIT_LINE wording", () => {
  assert.equal(NO_SUBMIT_LINE, "Downloaded the public SDK list. Sent no SDK names.");
});

test("privacyLine: offline, no-submit, nothing posted, names posted, and not looked up", () => {
  assert.equal(privacyLine({ offline: true, lookedUp: false, skippedPrivate: 2 }), "Checked fully offline. Nothing left this machine.");

  assert.equal(
    privacyLine({ offline: false, noSubmit: true, lookedUp: true, skippedPrivate: 2, submitted: 0, pendingUnknown: 3 }),
    NO_SUBMIT_LINE,
  );

  assert.equal(
    privacyLine({ offline: false, lookedUp: true, skippedPrivate: 0, submitted: 0, pendingUnknown: 0 }),
    "Downloaded the public SDK list. No unknown SDKs, so nothing was sent.",
  );
  assert.equal(
    privacyLine({ offline: false, lookedUp: true, skippedPrivate: 1, submitted: 0, pendingUnknown: 0 }),
    "Downloaded the public SDK list. No unknown SDKs, so nothing was sent. 1 private or internal library was skipped and never sent.",
  );
  assert.equal(
    privacyLine({ offline: false, lookedUp: true, skippedPrivate: 3, submitted: 0, pendingUnknown: 0 }),
    "Downloaded the public SDK list. No unknown SDKs, so nothing was sent. 3 private or internal libraries were skipped and never sent.",
  );

  assert.equal(
    privacyLine({ offline: false, lookedUp: true, skippedPrivate: 0, submitted: 1, pendingUnknown: 1 }),
    "Downloaded the public SDK list. Sent 1 unknown public SDK name to be checked.",
  );
  assert.equal(
    privacyLine({ offline: false, lookedUp: true, skippedPrivate: 2, submitted: 4, pendingUnknown: 4 }),
    "Downloaded the public SDK list. Sent 4 unknown public SDK names to be checked. 2 private or internal libraries were skipped and never sent.",
  );

  assert.equal(
    privacyLine({ offline: false, lookedUp: true, skippedPrivate: 1, submitted: 0, pendingUnknown: 2 }),
    NO_SUBMIT_LINE,
  );

  assert.equal(
    privacyLine({ offline: false, lookedUp: false, skippedPrivate: 0 }),
    "Checked locally. Nothing about your project was uploaded.",
  );
  assert.equal(
    privacyLine({ offline: false, lookedUp: false, skippedPrivate: 1 }),
    "Checked locally. Nothing about your project was uploaded. 1 private or internal library was skipped and never sent.",
  );
});
