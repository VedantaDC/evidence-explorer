// Finalize an AI pilot run: merge verifier verdicts into the adjudicated curations,
// rebuild v2 documents (literal-anchor checks), aggregate machine-tier Table 8.3,
// and draw a stratified random audit sample for human spot-checking.
//
// Usage: node scripts/v2/pilot-finalize.mjs --pilot <dir> --python <python> [--seed 20260924] [--per-stratum 20]
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ExcelJS from "exceljs";
import { buildTable83, CHAIN_FIELDS, effectiveCategory, effectiveValue } from "../../app/evidence-v2/model.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const repo = fileURLToPath(new URL("../../", import.meta.url));
const pilot = path.resolve(arg("pilot"));
const python = arg("python", "python3");
const seed = Number(arg("seed", "20260924"));
const perStratum = Number(arg("per-stratum", "20"));
const dataRoot = path.resolve(repo, "..");
const ks = (await fs.readFile(path.join(pilot, "pilot_k_numbers.txt"), "utf8")).trim().split(/\s+/);
const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const exists = (p) => fs.access(p).then(() => true, () => false);

const curationOut = path.join(repo, "pipeline/curation/pilot_mnr20");
const buildOut = path.join(pilot, "build");
await fs.mkdir(curationOut, { recursive: true });
await fs.mkdir(buildOut, { recursive: true });

const report = [];
const docs = [];
for (const k of ks) {
  const finalPath = path.join(pilot, "final", `${k}.json`);
  const verifyPath = path.join(pilot, "verify", `${k}.json`);
  if (!(await exists(finalPath))) { report.push({ k, status: "no final curation" }); continue; }
  const cur = await readJson(finalPath);
  const ver = (await exists(verifyPath)) ? await readJson(verifyPath) : { items: [] };
  const verdicts = new Map(ver.items.map((i) => [`${i.kind}:${i.ref}`, i]));
  let missing = 0;
  const stamp = (x, kind) => {
    const v = verdicts.get(`${kind}:${x.ref}`);
    if (!v) missing++;
    x.machine_review = { ...(x.machine_review || {}),
      status: !v ? "unverified" : v.verdict === "supported" ? "machine-verified" : "machine-rejected",
      verifier_problem: v?.problem || "not checked", verifier_reason: v?.reason || "", verifier_fix: v?.suggested_fix || "" };
  };
  cur.claims.forEach((c) => stamp(c, "claim"));
  cur.relationships.forEach((r) => stamp(r, "relationship"));
  cur.pipeline_run = { method: "double independent AI extraction (A: session model, B: sonnet) → AI adjudication → independent adversarial AI verification",
    verifier_items: ver.items.length, verifier_missing: missing };
  const curPath = path.join(curationOut, `${k}.json`);
  await fs.writeFile(curPath, JSON.stringify(cur, null, 1) + "\n");
  try {
    execFileSync(python, [path.join(repo, "pipeline/build_document_v2.py"), "--pdf", path.join(dataRoot, "data/regulatory_documents", k, `${k}_original.pdf`),
      "--legacy", path.join(repo, "public/evidence_data/documents", `${k}.json`), "--v1-packet", path.join(repo, "public/evidence_data/review_packet.json"),
      "--curation", curPath, "--out-dir", buildOut, "--no-render"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    report.push({ k, status: "build failed", error: String(e.stderr || e).slice(0, 2000) });
    continue;
  }
  const doc = await readJson(path.join(buildOut, "documents", `${k}.json`));
  docs.push(doc);
  const items = [...doc.claims, ...doc.relationships].filter((x) => x.machine_review);
  const by = (f) => items.filter(f).length;
  report.push({ k, status: "ok", device: doc.document.device_name, claims: doc.claims.filter((c) => c.origin === "prototype-curation").length,
    relationships: doc.relationships.length, machine_verified: by((x) => x.machine_review.status === "machine-verified"),
    machine_rejected: by((x) => x.machine_review.status === "machine-rejected"), unverified: by((x) => x.machine_review.status === "unverified"),
    agreed_both: by((x) => x.machine_review.agreement === "both"),
    eligibility: effectiveValue(doc.claims.find((c) => c.field === "eligibility") || { normalized_value: "missing" }) });
}

const table = buildTable83(docs, { tier: "machine", requireEligibility: true });
const out = { schema_version: "2.0-pilot", tier: "machine", corpus: "20 most recent MNR clearances with an available FDA PDF", k_numbers: ks,
  ...table, per_clearance: report };
await fs.writeFile(path.join(pilot, "table83_machine.json"), JSON.stringify(out, null, 1) + "\n");

// ---------------------------------------------------------------- markdown rendering (team format)
const list = (xs) => xs.length ? xs.map((x) => `${x.label} (n=${x.clearances})`).join("; ") : "—";
let md = `# Table 8.3 — pilot (machine tier), 20 most recent MNR clearances\n\n${table.rule}\n\n`;
md += "| Physiological parameter | Sensor type | No. devices (families) / clearances | Sensor location(s) | Raw/acquired signal identified | Direct / derived | Derived/reported features |\n|---|---|---|---|---|---|---|\n";
for (const r of table.rows) for (const [i, s] of r.sensors.entries())
  md += `| ${i ? "" : `**${r.parameter}** (${r.families} fam. / ${r.clearances} clr.)`} | ${s.sensor_type} | ${s.families} / ${s.clearances} | ${list(s.locations)} | ${list(s.raw_signals)} | ${list(s.derivation)} | ${list(s.features)}${s.exclusions.length ? `; explicitly not reported: ${list(s.exclusions)}` : ""} |\n`;
md += `\nExcluded: ${table.excluded_chains.filter((e) => e.chain_id === "*").map((e) => `${e.k_number} (${e.reason})`).join("; ") || "none"}\n`;
await fs.writeFile(path.join(pilot, "table83_machine.md"), md);

// ---------------------------------------------------------------- stratified audit sample
let s = seed >>> 0;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pool = [];
for (const d of docs) {
  const byId = new Map(d.claims.map((c) => [c.claim_id, c]));
  for (const c of d.claims.filter((c) => c.origin === "prototype-curation"))
    pool.push({ d, x: c, stratum: c.machine_review?.status !== "machine-verified" ? "rejected-by-verifier" : c.value_state !== "stated" ? "gap (Not stated)" : CHAIN_FIELDS.includes(c.field) ? c.field : c.field === "eligibility" ? "eligibility" : "supplementary" });
  for (const r of d.relationships)
    pool.push({ d, x: r, byId, stratum: r.machine_review?.status !== "machine-verified" ? "rejected-by-verifier" : r.basis === "not-stated" ? "link not stated" : "relationship" });
}
const strata = [...new Set(pool.map((p) => p.stratum))];
const sample = strata.flatMap((st) => shuffle(pool.filter((p) => p.stratum === st)).slice(0, st === "eligibility" ? 20 : perStratum));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Audit sample", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = [["id", "Item ID", 20], ["k", "510(k)", 10], ["device", "Device", 22], ["stratum", "Stratum", 18], ["field", "Field / relation", 20], ["value", "Proposed value", 36],
  ["category", "Table 8.3 category", 24], ["quote", "Primary quote", 60], ["page", "Page", 6], ["scope", "Scope", 10], ["agreement", "A/B agreement", 11],
  ["mstatus", "Machine status", 15], ["vreason", "Verifier reason", 40], ["pdf", "FDA PDF", 22], ["verdict", "YOUR VERDICT (correct / incorrect / unsure)", 22], ["notes", "Your notes", 36]]
  .map(([key, header, width]) => ({ key, header, width }));
ws.getRow(1).font = { bold: true };
for (const { d, x, byId, stratum } of sample) {
  const p = x.evidence?.find((a) => a.role === "primary") || x.evidence?.[0];
  const isRel = !!x.relationship_id;
  ws.addRow({ id: x.claim_id || x.relationship_id, k: d.document.k_number, device: d.document.device_name, stratum,
    field: isRel ? x.relation : x.field,
    value: isRel ? `${effectiveValue(byId.get(x.from_claim_id))} → ${effectiveValue(byId.get(x.to_claim_id))} (${x.basis})` : effectiveValue(x),
    category: isRel ? "" : effectiveCategory(x), quote: p?.exact_quote || (x.absence_check ? `Absence check: ${x.absence_check.terms.join(", ")} → ${x.absence_check.subject_hit_count} subject hits` : ""),
    page: p?.page || "", scope: p?.scope || "", agreement: x.machine_review?.agreement || "", mstatus: x.machine_review?.status || "",
    vreason: x.machine_review?.verifier_reason || "", pdf: { text: `${d.document.k_number} p.${p?.page || 1}`, hyperlink: `${d.document.source_url}#page=${p?.page || 1}` } });
}
ws.eachRow((r, i) => { r.alignment = { wrapText: true, vertical: "top" }; if (i > 1) { r.getCell(15).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0C9" } }; r.getCell(15).dataValidation = { type: "list", formulae: ['"correct,incorrect,unsure"'] }; } });
await wb.xlsx.writeFile(path.join(pilot, "audit_sample.xlsx"));

console.log(JSON.stringify({ built: docs.length, failed: report.filter((r) => r.status !== "ok"), table_rows: table.rows.length,
  audit_items: sample.length, strata: Object.fromEntries(strata.map((st) => [st, sample.filter((p) => p.stratum === st).length])) }, null, 1));
