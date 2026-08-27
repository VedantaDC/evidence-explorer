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
  assert.match(source, /A consolidated view: each physiological measurement appears once/);
  assert.match(source, /cleanInventoryGroups/);
  assert.match(source, /FDA corpus evidence/);
  assert.match(source, /High-confidence acquired signal/);
  assert.match(source, /Explicit derived physiological feature\(s\)/);
  assert.match(source, /Acquired signals are shown only when the documented sensor and measured parameter establish them directly/);
  assert.match(source, /linked 510\(k\)s · view evidence/);
  assert.match(source, /directRecords=dedupeEvidence\(sensorEvidence/);
  assert.match(source, /FDA facts separated from literature-based interpretation/);
  assert.match(source, /unique device families\/configurations supporting that measurement–sensor row/);
  assert.match(source, /Four physiological mechanisms of OSA/);
  assert.match(source, /Physiological measurement glossary/);
  assert.match(source, /Sensor technology glossary/);
  assert.match(source, /How to read the evidence chain/);
  assert.match(source, /One collapsible section per physiological parameter/);
  assert.match(source, /highConfidenceAcquiredSignal/);
  assert.match(source, /isHighConfidenceReportedFeature/);
  assert.match(source, /FILTERED EVIDENCE LIST/);
  assert.match(source, /Read measurement definition/);
  assert.match(source, /N=\{item\.familyCount\}/);
  assert.doesNotMatch(source, /const raw=unique\(outputs\.filter/);
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
  assert.equal(other.stats.included_clearances, 62);
  assert.equal(other.stats.included_families, 40);
  assert.equal(other.stats.excluded_clearances, 39);
  assert.equal(other.stats.olv_included, 54);
  assert.equal(other.stats.olz_included, 8);
  assert.equal(other.stats.sensor_facts, 191);
  assert.equal(other.stats.output_facts, 285);
  assert.equal(other.audit.length, 101);
  assert.match(other.stats.scope_rule, /full PSG systems/i);
  assert.ok(other.families.some((row) => /Nox Sleep System/.test(row.family_name)));
  assert.ok(other.families.some((row) => /Alice PSG systems/.test(row.family_name)));
  assert.ok(other.families.some((row) => /Polysmith Sleep System/.test(row.family_name)));
  assert.ok(other.sensors.some((row) => /EEG electrodes/.test(row.sensor)));
  assert.ok(other.sensors.some((row) => /CO2 \/ capnography/.test(row.sensor)));
  assert.ok(!other.sensors.some((row) => /ambient light/i.test(`${row.sensor} ${row.measurement}`)));
  assert.ok(!other.outputs.some((row) => /ambient light|light detection/i.test(row.standardized_output)));
  assert.ok(other.clearances.every((row) => /^https:\/\//.test(row.source_url)));
  assert.ok(workbook.byteLength > 100_000);
});
