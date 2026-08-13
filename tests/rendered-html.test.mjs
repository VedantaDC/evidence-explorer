import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MNR evidence explorer shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MNR Evidence Explorer<\/title>/i);
  assert.match(html, /Preparing the MNR evidence explorer/i);
  assert.match(html, /social-preview\.png/i);
  assert.match(html, /Core, Expanded, and Historical evidence/i);
});

test("ships the expanded evidence corpus and downloadable workbook", async () => {
  const [dataText, workbook] = await Promise.all([
    readFile(new URL("../public/dashboard_data.json", import.meta.url), "utf8"),
    readFile(new URL("../public/MNR_Curated_Analysis.xlsx", import.meta.url)),
  ]);
  const data = JSON.parse(dataText);

  assert.equal(data.stats.total_families_audited, 105);
  assert.equal(data.stats.included_families, 82);
  assert.equal(data.stats.excluded_families, 23);
  assert.equal(data.stats.core_families, 51);
  assert.equal(data.stats.expanded_families, 21);
  assert.equal(data.stats.historical_families, 10);
  assert.ok(data.sensors.some((row) => row.standardized_location === "Location not specified"));
  assert.ok(workbook.byteLength > 100_000);
});
