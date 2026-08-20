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

test("server-renders the evidence explorer shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Evidence Explorer<\/title>/i);
  assert.match(html, /Preparing the sleep-device evidence explorer/i);
  assert.match(html, /social-preview\.png/i);
  assert.match(html, /curated FDA 510\(k\) evidence/i);
});

test("ships separate data and analysis views with case-normalized filters", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /Data overview/);
  assert.match(source, /Analysis overview/);
  assert.match(source, /Sensor facts by latest-clearance era/);
  assert.match(source, /function unique\(values: string\[\]\)/);
  assert.match(source, /toLocaleLowerCase/);
  assert.match(source, /sameLabel\(o\.standardized_output, output\)/);
  assert.match(source, /Cross-corpus analysis/);
  assert.match(source, /8\.3 Cumulative FDA measurement inventory/);
  assert.match(source, /8\.4 Mechanism × feature × FDA capability map/);
  assert.match(source, /Physiological measurement → sensor → location/);
  assert.match(source, /FDA facts separated from literature-based interpretation/);
  assert.match(source, /Device × Sensor × Physiological Parameter/);
  assert.match(source, /Four physiological mechanisms of OSA/);
  assert.match(source, /Physiological measurement glossary/);
  assert.match(source, /Sensor technology glossary/);
  assert.match(source, /How to read the evidence chain/);
});

test("ships the expanded evidence corpus and downloadable workbook", async () => {
  const [dataText, otherText, workbook] = await Promise.all([
    readFile(new URL("../public/dashboard_data.json", import.meta.url), "utf8"),
    readFile(new URL("../public/other_codes_data.json", import.meta.url), "utf8"),
    readFile(new URL("../public/MNR_Curated_Analysis.xlsx", import.meta.url)),
  ]);
  const data = JSON.parse(dataText);
  const other = JSON.parse(otherText);

  assert.equal(data.stats.total_families_audited, 105);
  assert.equal(data.stats.included_families, 82);
  assert.equal(data.stats.excluded_families, 23);
  assert.equal(data.stats.core_families, 51);
  assert.equal(data.stats.expanded_families, 21);
  assert.equal(data.stats.historical_families, 10);
  assert.ok(data.sensors.some((row) => row.standardized_location === "Location not specified"));
  assert.equal(other.stats.total_clearances_screened, 101);
  assert.equal(other.stats.included_families, 7);
  assert.equal(other.stats.excluded_clearances, 94);
  assert.equal(other.stats.olv_included, 6);
  assert.equal(other.stats.olz_included, 1);
  assert.equal(other.audit.length, 101);
  assert.match(other.stats.scope_rule, /reduced-channel configurations/i);
  assert.ok(other.families.some((row) => /Nox Sleep System/.test(row.family_name)));
  assert.ok(other.families.some((row) => /Level 3 HSAT/.test(row.family_name)));
  assert.ok(workbook.byteLength > 100_000);
});
