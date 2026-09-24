// Portable review I/O for v2 evidence records (JSON packet + Excel workbook).
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { applyReviews, buildPacket, buildTable83, DECISIONS, REVIEW_FIELDS, reviewsFromPacket } from "../../app/evidence-v2/model.mjs";

export const root = new URL("../../", import.meta.url);
export const v2Dir = new URL("public/evidence_data/v2/", root);
export const paths = {
  manifest: new URL("manifest.json", v2Dir),
  packet: new URL("review/review_packet_v2.json", v2Dir),
  workbook: new URL("review/Evidence_Review_v2.xlsx", v2Dir),
  table83: new URL("table83_verified_v2.json", v2Dir),
};
const SITE = "https://vedantadc.github.io/evidence-explorer/";

const readJson = async (u) => JSON.parse(await fs.readFile(u, "utf8"));
const exists = (u) => fs.access(u).then(() => true, () => false);

/** Load v2 documents and overlay the canonical review packet (the packet is authoritative for review fields). */
export async function loadV2({ packetOverride } = {}) {
  const manifest = await readJson(paths.manifest);
  const docs = await Promise.all(manifest.documents.map((d) => readJson(new URL(d.document, v2Dir))));
  const packet = packetOverride ?? ((await exists(paths.packet)) ? await readJson(paths.packet) : null);
  const reviews = packet ? reviewsFromPacket(packet) : {};
  return { manifest, packet, docs: docs.map((d) => applyReviews(d, reviews)) };
}

export function generatedAt(docs) {
  return docs.map((d) => d.build.built_at_utc).sort().at(-1);
}

export async function writeArtifacts(docs) {
  const packet = buildPacket(docs, generatedAt(docs));
  const table83 = { schema_version: "2.0-prototype", generated_from: "review/review_packet_v2.json", ...buildTable83(docs) };
  await fs.mkdir(new URL("review/", v2Dir), { recursive: true });
  await fs.writeFile(paths.packet, JSON.stringify(packet, null, 1) + "\n");
  await fs.writeFile(paths.table83, JSON.stringify(table83, null, 1) + "\n");
  await writeWorkbook(packet, docs, table83, paths.workbook);
  return { packet, table83 };
}

// ---------------------------------------------------------------- workbook

const CLAIM_COLS = [
  ["claim_id", "Claim ID", 20], ["k_number", "510(k)", 10], ["chain_ids", "Chain(s)", 24], ["field", "Field", 22],
  ["value_state", "Value state", 12], ["polarity", "Polarity", 10], ["normalized_value", "Proposed normalized value", 40],
  ["category", "Table 8.3 category", 26], ["source_value", "Source wording", 30], ["interpretation_v2", "Interpretation", 13],
  ["subject_scope", "Evidence scope", 11], ["page", "Page", 6], ["primary_quote", "Primary exact quote", 60],
  ["evidence_fingerprint", "Evidence fingerprint", 18],
];
const REL_COLS = [
  ["relationship_id", "Relationship ID", 20], ["k_number", "510(k)", 10], ["chain_id", "Chain", 24], ["from_claim_id", "From claim", 20],
  ["from_value", "From value", 32], ["relation", "Relation", 16], ["to_claim_id", "To claim", 20], ["to_value", "To value", 32],
  ["basis", "Basis", 14], ["note", "Note", 40], ["evidence_fingerprint", "Evidence fingerprint", 18],
];
const REVIEW_COLS = [
  ["review_decision", "Review decision", 20], ["reviewed_value", "Reviewed value", 30], ["reviewed_category", "Reviewed category", 22],
  ["reviewer", "Reviewer", 14], ["reviewer_date", "Reviewer date", 13], ["reviewer_notes", "Reviewer notes", 40],
  ["reviewed_evidence_fingerprint", "Reviewed evidence fingerprint", 18],
];

function sheet(wb, name, cols, rows, reviewStart) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  ws.columns = cols.map(([key, header, width]) => ({ key, header, width }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F5E" } };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  ws.eachRow((row, i) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (i > 1 && reviewStart) for (let c = reviewStart; c < reviewStart + REVIEW_COLS.length; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0C9" } };
  });
  const dateCol = cols.findIndex(([key]) => key === "reviewer_date") + 1;
  if (dateCol) ws.getColumn(dateCol).numFmt = "@";
  if (reviewStart && rows.length) {
    const col = reviewStart;
    for (let i = 2; i <= rows.length + 1; i++) ws.getCell(i, col).dataValidation = { type: "list", allowBlank: false, formulae: [`"${DECISIONS.join(",")}"`] };
  }
  return ws;
}

export async function writeWorkbook(packet, docs, table83, url) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "evidence-explorer scripts/v2";
  wb.created = new Date(packet.generated_at_utc);
  wb.modified = wb.created;
  const readme = wb.addWorksheet("Read me");
  readme.columns = [{ width: 30 }, { width: 110 }];
  [["Purpose", "Portable review of v2 claims and measurement-chain relationships (prototype: " + packet.k_numbers.join(", ") + ")."],
   ["Edit only", "Yellow columns (review decision, reviewed value/category, reviewer, date, notes). Import rejects any change to IDs, values or fingerprints."],
   ["Decisions", DECISIONS.join(" · ")],
   ["Rules", "Edit-and-verify needs a corrected value or category. Needs-clarification needs a note. Verifying an inferred item needs a note. A 'link not stated' relationship cannot be verified as a link."],
   ["Table 8.3", table83.rule],
   ["Staleness", "When evidence changes after review, the evidence fingerprint changes and the review stops counting until it is re-confirmed."],
   ["Import", "node scripts/v2/import-review.mjs <this file>.xlsx [--check-only]"],
   ["Authority", "The original FDA PDF is the ultimate regulatory source. This workbook is an unofficial research derivative."],
  ].forEach((r) => readme.addRow(r));
  readme.getColumn(1).font = { bold: true };
  readme.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });

  const claimById = new Map(packet.claims.map((c) => [c.claim_id, c]));
  const link = (k, id) => `${SITE}510k/${k}/#item=${id}`;
  const claimRows = packet.claims.map((c) => ({ ...c, chain_ids: c.chain_ids.join(", "), evidence_link: link(c.k_number, c.claim_id) }));
  const relRows = packet.relationships.map((r) => ({ ...r, from_value: claimById.get(r.from_claim_id)?.normalized_value ?? "", to_value: claimById.get(r.to_claim_id)?.normalized_value ?? "",
    evidence_link: link(r.k_number, r.relationship_id) }));
  sheet(wb, "Claims review", [...CLAIM_COLS, ...REVIEW_COLS, ["evidence_link", "Evidence page", 30]], claimRows, CLAIM_COLS.length + 1);
  sheet(wb, "Relationships review", [...REL_COLS, ...REVIEW_COLS, ["evidence_link", "Evidence page", 30]], relRows, REL_COLS.length + 1);

  const evRows = [];
  for (const d of docs) for (const x of [...d.claims, ...d.relationships]) for (const a of x.evidence || [])
    evRows.push({ id: x.claim_id || x.relationship_id, anchor_id: a.anchor_id, role: a.role, page: a.pages.join(", "), scope: a.scope, target: a.target.id,
      row_label: a.target.row_label || "", text_layer: a.text_layer, exact_quote: a.exact_quote });
  sheet(wb, "Evidence anchors", [["id", "Claim / relationship ID", 20], ["anchor_id", "Anchor ID", 16], ["role", "Role", 10], ["page", "Page(s)", 8],
    ["scope", "Scope", 11], ["target", "Block / cell ID", 26], ["row_label", "Table row", 24], ["text_layer", "Text layer", 14], ["exact_quote", "Exact quote", 80]], evRows);

  const t83 = [];
  for (const r of table83.rows) for (const s of r.sensors) t83.push({ parameter: r.parameter, parameter_n: `${r.clearances} clearances / ${r.families} families`, sensor: s.sensor_type,
    n: `${s.clearances} clearances / ${s.families} families`, loc: fmt(s.locations), raw: fmt(s.raw_signals), der: fmt(s.derivation), feat: fmt(s.features), excl: fmt(s.exclusions) });
  sheet(wb, "Table 8.3 (verified)", [["parameter", "Physiological parameter", 24], ["parameter_n", "Parameter N", 22], ["sensor", "Sensor type", 26], ["n", "Sensor-row N", 22],
    ["loc", "Sensor location(s)", 26], ["raw", "Raw/acquired signal", 30], ["der", "Direct / derived", 20], ["feat", "Derived/reported features", 40], ["excl", "Explicit exclusions", 24]],
    t83.length ? t83 : [{ parameter: "No verified rows. Table 8.3 is empty until claims and relationships are human-verified." }]);
  await wb.xlsx.writeFile(fileURLToPath(url));
}

const fmt = (list) => list.map((x) => `${x.label} (n=${x.clearances})`).join("; ");

const cellText = (cell) => {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);
  return String(v);
};

// Excel stores typed dates as day serials (1900 date system); normalize them to ISO dates.
const excelDate = (v) => /^\d{5}(\.\d+)?$/.test(v) ? new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10) : v;

/** Read review rows back from a workbook, keyed by header names (column order may change). */
export async function readWorkbook(url) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fileURLToPath(url));
  const read = (name, idKey) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`Workbook is missing sheet "${name}"`);
    const headers = {};
    ws.getRow(1).eachCell((cell, col) => { headers[col] = cell.text; });
    const byHeader = Object.fromEntries([...CLAIM_COLS, ...REL_COLS, ...REVIEW_COLS].map(([key, header]) => [header, key]));
    const rows = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const out = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => { const key = byHeader[headers[col]]; if (key) out[key] = key === "reviewer_date" ? excelDate(cellText(cell)) : cellText(cell); });
      if (out[idKey]) rows.push(Object.fromEntries(Object.entries(out).filter(([k]) => [idKey, "evidence_fingerprint", ...REVIEW_FIELDS, ...(idKey === "claim_id" ? ["normalized_value"] : ["relation", "basis"])].includes(k))));
    });
    return rows;
  };
  return { claims: read("Claims review", "claim_id"), relationships: read("Relationships review", "relationship_id") };
}

