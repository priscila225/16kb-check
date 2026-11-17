import assert from "node:assert/strict";
import { test } from "node:test";
import { isVendoredPath } from "../src/preflight/source.ts";

test("isVendoredPath detects vendor folders and components/*sdk*", () => {
  assert.equal(isVendoredPath("vendor/example-sdk/http.brs"), true);
  assert.equal(isVendoredPath("libs/example-analytics/tracker.brs"), true);
  assert.equal(isVendoredPath("lib/net.brs"), true);
  assert.equal(isVendoredPath("third_party/foo/bar.brs"), true);
  assert.equal(isVendoredPath("components/ExampleAnalyticsSdk/Main.brs"), true);
  assert.equal(isVendoredPath("components/foo-sdk/util.brs"), true);
  assert.equal(isVendoredPath("source/main.brs"), false);
  assert.equal(isVendoredPath("source/library.brs"), false);
  assert.equal(isVendoredPath("components/ExampleMainScene.brs"), false);
});
