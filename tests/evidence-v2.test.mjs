import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ExcelJS from "exceljs";
import { applyReviews, buildPacket, buildTable83, isCountable, mergePacket, reviewErrors, validateIncoming, VALUE_STATES } from "../app/evidence-v2/model.mjs";
import { readWorkbook, writeWorkbook } from "../scripts/v2/review-io.mjs";

const pub = new URL("../public/", import.meta.url);
const json = async (p) => JSON.parse(await readFile(new URL(p, pub), "utf8"));
const K = "K143272";
const doc = await json(`evidence_data/v2/documents/${K}.json`);
const v1 = await json(`evidence_data/documents/${K}.json`);
const v1Packet = await json("evidence_data/review_packet.json");
const byRef = new Map(doc.claims.map((c) => [c.curation_ref, c]));
const byId = new Map(doc.claims.map((c) => [c.claim_id, c]));
const unitText = new Map([...doc.blocks.map((b) => [b.block_id, b.text]), ...doc.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.map((c) => [c.cell_id, c.text])))]);
const allAnchors = [...doc.claims, ...doc.relationships].flatMap((x) => x.evidence.map((a) => [x, a]));

// ------------------------------------------------------------------ structure

test("v2 structure: parts, sections, artifacts and image-only page are explicit", () => {
  assert.deepEqual(doc.parts.map((p) => p.kind), ["letter", "ifu_form", "summary"]);
  assert.equal(doc.pages.length, v1.pages.length);
  const titles = doc.sections.map((s) => s.title);
  for (const t of ["Device Description", "Intended Use", "Technology", "Substantial Equivalence", "Testing summary"]) assert.ok(titles.includes(t), t);
  for (let p = 4; p <= 15; p++) {
    const roles = doc.artifacts.filter((a) => a.page === p).map((a) => a.role);
    assert.ok(roles.includes("running_header") && roles.includes("page_number"), `page ${p} furniture`);
  }
  for (const b of doc.blocks) assert.ok(!b.text.includes("Traditional 510(k) Premarket Notification"), `running header leaked into ${b.block_id}`);
  const p3 = doc.pages[2];
  assert.match(p3.text_layer, /^image-only/);
  assert.ok(p3.ocr && p3.ocr.words > 100, "image-only IFU page must carry an OCR layer");
  assert.ok(doc.blocks.some((b) => b.page === 3 && b.type === "ocr_text" && b.text_layer === "ocr_local_tesseract" && /indicated for use by Health Care Professionals/.test(b.text)));
});

test("v2 comparison table: column roles, merged cells and cross-page rows", () => {
  const t = doc.tables.find((x) => x.kind === "comparison");
  assert.deepEqual(t.columns.map((c) => c.role), ["characteristic", "predicate", "predicate", "subject", "comment"]);
  assert.deepEqual(t.columns.map((c) => c.k_number), ["", "K082113", "K131932", K, ""]);
  const row = (label) => t.rows.find((r) => r.label === label);
  const indices = row("Analysis result (Indices)");
  const shared = indices.cells.find((c) => c.col_ids.join() === "C3,C4");
  assert.equal(shared.scope, "shared");
  assert.match(shared.text, /^The following indices are\ngenerated from the ApneaLink Software:/);
  assert.deepEqual(row("Sensor Technology").pages, [9, 10]);
  assert.match(row("Sensor Technology").cells.find((c) => c.scope === "subject").text, /actigraphy\nsensor for position$/);
  assert.ok(row("IEC 60601-1 (Electrical safety)"), "row label split across a page break is rejoined");
  assert.equal(t.rows.length, 22);
  assert.ok(t.rows.every((r) => r.cells.every((c) => c.segments.every((s) => s.char_end >= s.char_start))));
});

test("v2 immutable raw layer equals the v1 extraction byte for byte", () => {
  assert.deepEqual(doc.legacy.pages, v1.pages);
  assert.deepEqual(doc.legacy.blocks, v1.blocks);
  assert.equal(doc.build.inputs.pdf_sha256, v1.document.sha256);
});

// ------------------------------------------------------------------ anchors

test("every evidence anchor is a literal slice of its block or cell, with page geometry", () => {
  assert.ok(allAnchors.length > 100);
  for (const [x, a] of allAnchors) {
    const text = unitText.get(a.target.id);
    assert.ok(text !== undefined, `${a.anchor_id}: unknown target ${a.target.id}`);
    assert.equal(text.slice(a.char_start, a.char_end), a.exact_quote, `${x.claim_id || x.relationship_id} ${a.anchor_id}`);
    assert.ok(a.bboxes.length > 0 && a.bboxes.every((b) => b.x1 > b.x0 && b.bottom > b.top), `${a.anchor_id} bbox`);
    assert.ok(a.pages.every((p) => p >= 1 && p <= doc.pages.length));
  }
});

// ------------------------------------------------------------------ migration

test("migration keeps every v1 claim ID, v1 field and review decision", () => {
  const v1Reviews = new Map(v1Packet.claims.filter((c) => c.k_number === K).map((c) => [c.claim_id, c]));
  for (const c of v1.claims) {
    const m = byId.get(c.claim_id);
    assert.ok(m, `v1 claim ${c.claim_id} missing`);
    for (const [k, v] of Object.entries(c)) if (!["review_decision", "reviewed_value", "reviewer_date", "reviewer_notes"].includes(k)) assert.deepEqual(m[k], v, `${c.claim_id}.${k}`);
    for (const k of ["review_decision", "reviewed_value", "reviewer_date", "reviewer_notes"]) assert.equal(m[k], v1Reviews.get(c.claim_id)[k], `${c.claim_id}.${k}`);
    assert.equal(m.origin, "v1-extraction");
    assert.ok(m.legacy_assessment?.verdict, `${c.claim_id} has an assessment`);
  }
});

test("new claim and relationship IDs are stable-format, unique, and never collide with v1 IDs", () => {
  const v1Ids = new Set(v1Packet.claims.map((c) => c.claim_id));
  const ids = doc.claims.map((c) => c.claim_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of doc.claims.filter((c) => c.origin === "prototype-curation")) {
    assert.match(c.claim_id, /^CLM-[0-9a-f]{12}$/);
    assert.ok(!v1Ids.has(c.claim_id), c.claim_id);
    assert.equal(c.review_decision, "pending", "the builder never creates a decision");
  }
  const rids = doc.relationships.map((r) => r.relationship_id);
  assert.equal(new Set(rids).size, rids.length);
  for (const r of doc.relationships) {
    assert.match(r.relationship_id, /^REL-[0-9a-f]{12}$/);
    assert.ok(byId.has(r.from_claim_id) && byId.has(r.to_claim_id));
    assert.equal(r.chain_id, doc.chains.find((c) => c.chain_id === r.chain_id)?.chain_id);
  }
});

// ------------------------------------------------------------------ scientific guards

test("no subject-device claim rests only on a predicate column", () => {
  for (const c of doc.claims.filter((c) => c.origin === "prototype-curation" && c.value_state === "stated")) {
    const prim = c.evidence.filter((a) => a.role === "primary");
    assert.ok(prim.length, `${c.curation_ref} has primary evidence`);
    assert.ok(prim.some((a) => a.scope !== "predicate"), `${c.curation_ref} relies on predicate column`);
  }
  const rip = byId.get("CLM-25cea7da6112");
  assert.equal(rip.legacy_assessment.recommended_action, "reject");
  assert.ok(rip.evidence.some((a) => a.scope === "predicate" && a.role === "limiting"));
  assert.ok(!doc.claims.some((c) => c.aggregate !== false && /RIP/.test(c.category || "")));
  assert.equal(byRef.get("eff.sensor").category, "Pneumatic effort sensor");
});

test("prohibited inferences are not made", () => {
  // SpO2 does not imply a PPG waveform
  const oxRaw = byRef.get("ox.raw");
  assert.equal(oxRaw.value_state, "Not stated");
  assert.equal(oxRaw.absence_check.subject_hit_count, 0);
  assert.ok(!doc.claims.some((c) => c.value_state === "stated" && /PPG|photopleth/i.test(c.normalized_value)));
  // pressure transducer is stated, not inferred from "airflow"
  const ps = byRef.get("np.sensor");
  assert.ok(ps.evidence.some((a) => a.role === "primary" && /solid-state pressure\s+sensor/.test(a.exact_quote)));
  // no calibrated quantitative effort
  assert.equal(byRef.get("eff.calib").value_state, "Not stated");
  assert.ok(!doc.claims.some((c) => c.value_state === "stated" && /calibrat|quantitative effort/i.test(c.normalized_value)));
  // AHI is an explicit output, but its link to any parameter is not stated
  const ahi = byRef.get("out.ahi");
  const ahiLinks = doc.relationships.filter((r) => r.from_claim_id === ahi.claim_id && r.relation !== "generated_by");
  assert.ok(ahiLinks.length && ahiLinks.every((r) => r.basis === "not-stated"));
  // location is not inferred from a sensor name: actigraphy location is marked inferred
  assert.equal(byRef.get("pos.loc").interpretation_v2, "inferred");
  // a recorded waveform is not a reported output
  assert.equal(byRef.get("pos.output").polarity, "negated");
  assert.equal(byId.get("CLM-030e4da72b91").legacy_assessment.recommended_action, "reject");
});

test("Not stated, Not applicable, Unreadable and blank remain distinct", () => {
  for (const c of doc.claims) assert.ok(VALUE_STATES.includes(c.value_state), c.claim_id);
  const gaps = doc.claims.filter((c) => c.value_state === "Not stated");
  assert.ok(gaps.length >= 8);
  assert.ok(gaps.every((c) => c.normalized_value === "Not stated" && c.interpretation_v2 === "not stated"));
  const effort = doc.chains.find((c) => c.chain_id === "CHN-K143272-EFFORT");
  assert.equal(effort.slots.derived_reported_feature.state, "", "blank slot means not assessed, not 'Not stated'");
  assert.equal(doc.chains.find((c) => c.chain_id === "CHN-K143272-SPO2").slots.raw_acquired_signal.state, "Not stated");
});

// ------------------------------------------------------------------ Table 8.3

const verifiedReviews = (d, skip = () => false) => {
  const out = {};
  for (const x of [...d.claims, ...d.relationships]) {
    const id = x.claim_id || x.relationship_id;
    if (skip(x)) continue;
    const reject = x.legacy_assessment?.recommended_action === "reject" || x.basis === "not-stated";
    out[id] = { review_decision: reject ? "rejected" : "verified", reviewed_value: "", reviewed_category: "", reviewer: "test", reviewer_date: "2026-09-24",
      reviewer_notes: (x.interpretation_v2 === "inferred" || x.basis === "inferred") ? "Accepted for test" : "", reviewed_evidence_fingerprint: x.evidence_fingerprint };
  }
  return out;
};
const row = (t, p) => t.rows.find((r) => r.parameter === p);

test("committed Table 8.3 is empty because nothing is human-verified", async () => {
  const t83 = await json("evidence_data/v2/table83_verified_v2.json");
  assert.equal(t83.rows.length, 0);
  assert.equal(buildTable83([doc]).rows.length, 0);
});

test("Table 8.3 aggregates parameter × sensor type from verified chains only", () => {
  const t = buildTable83([applyReviews(doc, verifiedReviews(doc))]);
  const air = row(t, "Airflow / respiration");
  assert.equal(air.clearances, 1); assert.equal(air.families, 1);
  const npt = air.sensors.find((s) => s.sensor_type === "Nasal pressure transducer");
  assert.deepEqual(npt.locations.map((x) => x.label), ["Nares / nasal cannula"]);
  assert.deepEqual(npt.raw_signals.map((x) => x.label), ["Nasal pressure signal (waveform not specified)"]);
  assert.ok(npt.features.some((f) => f.label === "Flow limitation"));
  assert.ok(!npt.features.some((f) => f.label === "AHI"), "AHI has no stated input link and must not be attached to airflow");
  assert.deepEqual(row(t, "Oxygen saturation").sensors[0].raw_signals.map((x) => x.label), ["Not specified"]);
  assert.equal(row(t, "Snoring / respiratory sounds").sensors[0].sensor_type, "Sensor not stated");
  const pos = row(t, "Body position").sensors[0];
  assert.deepEqual(pos.exclusions.map((x) => x.label), ["Excluded from report"]);
  assert.equal(pos.features.length, 0);
  assert.ok(!t.rows.some((r) => r.sensors.some((s) => /RIP/.test(s.sensor_type))));
});

test("pending, rejected, clarification, stale, and unlinked items never enter Table 8.3", () => {
  const param = byRef.get("np.param");
  const base = verifiedReviews(doc);
  const t = (patch) => buildTable83([applyReviews(doc, { ...base, ...patch })]);
  for (const decision of ["pending", "rejected", "needs clarification"])
    assert.equal(row(t({ [param.claim_id]: { ...base[param.claim_id], review_decision: decision, reviewer_notes: "x" } }), "Airflow / respiration"), undefined, decision);
  assert.equal(row(t({ [param.claim_id]: { ...base[param.claim_id], reviewed_evidence_fingerprint: "0000" } }), "Airflow / respiration"), undefined, "stale review");
  const acquires = doc.relationships.find((r) => r.chain_id === "CHN-K143272-AIRFLOW" && r.relation === "acquires");
  const unlinked = row(t({ [acquires.relationship_id]: { ...base[acquires.relationship_id], review_decision: "pending" } }), "Airflow / respiration");
  assert.deepEqual(unlinked.sensors.map((s) => s.sensor_type), ["(sensor link not verified)"]);
  const pos = byRef.get("pos.loc");
  const noNote = t({ [pos.claim_id]: { ...base[pos.claim_id], reviewer_notes: "" } });
  assert.equal(isCountable(applyReviews(doc, { [pos.claim_id]: { ...base[pos.claim_id], reviewer_notes: "" } }).claims.find((c) => c.claim_id === pos.claim_id)), false);
  assert.ok(!row(noNote, "Body position").sensors[0].locations.length, "inferred location verified without a note does not count");
});

test("clearance counts and device-family counts stay separate", () => {
  const reviewed = applyReviews(doc, verifiedReviews(doc));
  const clone = { ...reviewed, document: { ...reviewed.document, k_number: "K999999" } };
  const other = { ...reviewed, document: { ...reviewed.document, k_number: "K888888", family_id: "DF-9999" } };
  const air = row(buildTable83([reviewed, clone, other]), "Airflow / respiration");
  assert.equal(air.clearances, 3);
  assert.equal(air.families, 2);
});

// ------------------------------------------------------------------ packets and workbook

test("review packets reject ID, value, and evidence changes and enforce decision rules", () => {
  const canonical = buildPacket([doc], "2026-09-24T00:00:00Z");
  const c = canonical.claims.find((x) => x.claim_id === byRef.get("np.sensor").claim_id);
  const notStated = canonical.relationships.find((r) => r.basis === "not-stated");
  const cases = [
    [{ claims: [{ claim_id: "CLM-000000000000", review_decision: "verified" }] }, /unknown ID/],
    [{ claims: [{ ...c, normalized_value: "RIP belt", review_decision: "verified" }] }, /normalized_value changed/],
    [{ claims: [{ ...c, evidence_fingerprint: "abc", review_decision: "verified" }] }, /different evidence/],
    [{ claims: [{ ...c, review_decision: "edited and verified" }] }, /needs a corrected value/],
    [{ claims: [{ ...c, review_decision: "needs clarification" }] }, /needs a note/],
    [{ relationships: [{ ...notStated, review_decision: "verified" }] }, /cannot be verified as a link/],
    [{ claims: [{ ...c, review_decision: "approved" }] }, /invalid decision/],
  ];
  for (const [incoming, re] of cases) assert.match(validateIncoming(canonical, incoming).errors.join("\n"), re);
  const ok = validateIncoming(canonical, { claims: [{ claim_id: c.claim_id, review_decision: "verified", reviewer: "PS", reviewer_date: "2026-09-24" }] });
  assert.deepEqual(ok.errors, []);
  const merged = mergePacket(canonical, ok.updates);
  const m = merged.claims.find((x) => x.claim_id === c.claim_id);
  assert.equal(m.review_decision, "verified");
  assert.equal(m.reviewed_evidence_fingerprint, c.evidence_fingerprint);
  assert.deepEqual(merged.claims.map((x) => x.claim_id), canonical.claims.map((x) => x.claim_id));
  assert.deepEqual(reviewErrors(byRef.get("pos.loc"), { review_decision: "verified" }).length, 1);
});

test("Excel workbook round-trips review fields without altering IDs", async () => {
  const canonical = buildPacket([doc], "2026-09-24T00:00:00Z");
  const dir = await mkdtemp(join(tmpdir(), "v2-review-"));
  const filePath = join(dir, "review.xlsx");
  const file = pathToFileURL(filePath);
  await writeWorkbook(canonical, [doc], buildTable83([doc]), file);
  const unchanged = await readWorkbook(file);
  assert.equal(unchanged.claims.length, canonical.claims.length);
  assert.equal(unchanged.relationships.length, canonical.relationships.length);
  const clean = validateIncoming(canonical, unchanged, { requireComplete: true });
  assert.deepEqual(clean.errors, []);
  assert.equal(Object.keys(clean.updates).length, 0);
  const target = byRef.get("ox.param").claim_id;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Claims review");
  const header = {}; ws.getRow(1).eachCell((cell, col) => { header[cell.text] = col; });
  ws.eachRow((r) => { if (r.getCell(header["Claim ID"]).text === target) { r.getCell(header["Review decision"]).value = "verified"; r.getCell(header["Reviewer date"]).value = new Date("2026-09-24"); } });
  await wb.xlsx.writeFile(filePath);
  const edited = validateIncoming(canonical, await readWorkbook(file));
  assert.deepEqual(edited.errors, []);
  assert.deepEqual(Object.keys(edited.updates), [target]);
  assert.equal(edited.updates[target].reviewer_date, "2026-09-24");
});

test("committed v2 packet mirrors the v2 document and ships with the Pages build", async () => {
  const packet = await json("evidence_data/v2/review/review_packet_v2.json");
  assert.deepEqual(packet.claims.map((c) => c.claim_id).sort(), doc.claims.map((c) => c.claim_id).sort());
  assert.deepEqual(packet.relationships.map((r) => r.relationship_id).sort(), doc.relationships.map((r) => r.relationship_id).sort());
  for (const c of packet.claims) assert.equal(c.evidence_fingerprint, byId.get(c.claim_id).evidence_fingerprint);
  const dist = new URL("../pages-dist/", import.meta.url);
  await access(new URL(`510k/${K}/index.html`, dist));
  await access(new URL("evidence_data/v2/manifest.json", dist));
  await access(new URL(`evidence_data/v2/pages/${K}/p-15.png`, dist));
  const src = await readFile(new URL("../app/evidence-v2/ClearanceWorkspace.tsx", import.meta.url), "utf8");
  assert.match(src, /startsWith\("\/evidence-explorer"\)/, "asset paths must work under /evidence-explorer/ and /");
  assert.match(src, /role="tablist"/);
  assert.match(src, /aria-selected/);
});

// ------------------------------------------------------------------ machine tier (AI pipeline)

const machineAll = (d, patch = () => ({})) => ({ ...d,
  claims: d.claims.map((c) => ({ ...c, machine_review: { status: "machine-verified" }, ...patch(c) })),
  relationships: d.relationships.map((r) => ({ ...r, machine_review: { status: "machine-verified" }, ...patch(r) })) });

test("machine tier counts machine-verified items only; human decisions override; inferred and not-stated never count", () => {
  const m = machineAll(doc);
  assert.equal(buildTable83([m]).rows.length, 0, "machine status never leaks into the human tier");
  const t = buildTable83([m], { tier: "machine" });
  assert.ok(row(t, "Airflow / respiration"));
  assert.ok(!row(t, "Body position").sensors[0].locations.length, "inferred actigraphy location is excluded at the machine tier");
  const param = byRef.get("np.param").claim_id;
  const rejected = machineAll(doc, (x) => (x.claim_id === param ? { review_decision: "rejected" } : {}));
  assert.equal(row(buildTable83([rejected], { tier: "machine" }), "Airflow / respiration"), undefined, "a human rejection overrides the machine");
  const machineRejected = machineAll(doc, (x) => (x.claim_id === param ? { machine_review: { status: "machine-rejected" } } : {}));
  assert.equal(row(buildTable83([machineRejected], { tier: "machine" }), "Airflow / respiration"), undefined);
  assert.ok(!row(t, "Airflow / respiration").sensors[0].features.some((f) => f.label === "AHI"), "policy A: AHI not linked");
});

test("eligibility gate excludes clearances without a verified eligible IFU claim", () => {
  const m = machineAll(doc);
  const gated = buildTable83([m], { tier: "machine", requireEligibility: true });
  assert.equal(gated.rows.length, 0);
  assert.deepEqual(gated.eligibility, [{ k_number: K, status: "not established" }]);
  const withElig = { ...m, claims: [...m.claims, { claim_id: "CLM-elig", field: "eligibility", normalized_value: "Eligible", value_state: "stated", evidence: [],
    evidence_fingerprint: "x", review_decision: "pending", machine_review: { status: "machine-verified" } }] };
  assert.ok(buildTable83([withElig], { tier: "machine", requireEligibility: true }).rows.length > 0);
  const notElig = { ...withElig, claims: withElig.claims.map((c) => (c.claim_id === "CLM-elig" ? { ...c, normalized_value: "Not eligible" } : c)) };
  assert.equal(buildTable83([notElig], { tier: "machine", requireEligibility: true }).rows.length, 0);
});
