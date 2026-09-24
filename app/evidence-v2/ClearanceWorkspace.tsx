"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  BASIS_LABELS, CHAIN_FIELDS, DECISIONS, FIELD_LABELS, RELATION_LABELS, SUPPLEMENTARY_FIELDS,
  applyReviews, buildTable83, effectiveValue, isStale, progress, reviewErrors, reviewsFromPacket, validateIncoming,
} from "./model.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Anchor = {
  anchor_id: string; role: string; target: { kind: string; id: string; table_id?: string; row_id?: string; row_label?: string; col_ids?: string[] };
  page: number; pages: number[]; section_id: string; exact_quote: string; char_start: number; char_end: number;
  bboxes: { page: number; x0: number; top: number; x1: number; bottom: number }[]; text_layer: string; scope: string;
  value_span?: [number, number]; ocr_min_conf?: number | null; note?: string;
};
type Review = { review_decision: string; reviewed_value: string; reviewed_category: string; reviewer: string; reviewer_date: string; reviewer_notes: string; reviewed_evidence_fingerprint: string };
type Claim = Review & {
  claim_id: string; k_number: string; field: string; source_value: string; normalized_value: string; value_state: string; polarity: string;
  category: string; aggregate: boolean; aggregate_note?: string; interpretation_v2: string; interpretation_status: string; interpretation_note: string;
  subject_scope: string; evidence: Anchor[]; evidence_fingerprint: string; origin: string; curation_ref: string; supporting_excerpt: string; block_id: string; page: number;
  evidence_text_match: string; legacy_assessment?: { verdict: string; recommended_action: string; note: string; superseded_by?: string[]; suggested_reviewed_value?: string };
  absence_check?: { terms: string[]; searched: string; hit_count: number; subject_hit_count: number; hits: { term: string; target_id: string; page: number; scope: string; context: string }[] };
};
type Relationship = Review & { relationship_id: string; chain_id: string; from_claim_id: string; to_claim_id: string; relation: string; basis: string; note: string; evidence: Anchor[]; evidence_fingerprint: string };
type Item = Claim | Relationship;
type Line = { text: string; bbox: number[]; page: number; para_break?: boolean; ocr_words?: [number, number, number][] };
type Block = { block_id: string; page: number; pages: number[]; section_id: string; order: number; type: string; text: string; lines: Line[]; text_layer: string; level?: number; table_id?: string; preserve_lines?: boolean; lead_in?: string; layout_note?: string; ocr_min_conf?: number; ocr_mean_conf?: number; ocr_low_conf_words?: number; legacy_block_ids?: string[] };
type Cell = { cell_id: string; col_ids: string[]; scope: string; text: string; segments: { page: number; bbox: number[]; char_start: number; char_end: number; lines: Line[] }[]; legacy_block_ids?: string[] };
type Table = { table_id: string; kind: string; title: string; structure_method: string; structure_confidence: string; pages: number[]; columns: { col_id: string; label: string; group?: string; role: string; device?: string; k_number?: string }[]; rows: { row_id: string; label: string; pages: number[]; cells: Cell[] }[] };
type Section = { section_id: string; part_id: string; parent_id: string | null; level: number; title: string; title_source: string; page_start: number; page_end: number; block_ids: string[] };
type Chain = { chain_id: string; kind: string; label: string; summary: string; slots: Record<string, { state: string; claim_ids: string[] }>; caveats: string[] };
type Page = { page: number; width: number; height: number; orientation: string; page_label: string; part_id: string; text_layer: string; render: string; tables_detected: number; ocr?: { engine: string; dpi: number; words: number; mean_conf: number; low_conf_words: number } };
type V2Doc = {
  schema_version: string; document: Record<string, any>; build: Record<string, any>; legacy: { pages: { page: number; extraction_method: string; text: string }[]; blocks: { block_id: string; page: number; text: string }[] };
  pages: Page[]; parts: { part_id: string; kind: string; title: string; title_source: string; pages: number[] }[]; sections: Section[];
  artifacts: { artifact_id: string; page: number; role: string; text: string; bbox: number[]; text_layer?: string; ocr_min_conf?: number }[];
  blocks: Block[]; tables: Table[]; claims: Claim[]; chains: Chain[]; relationships: Relationship[];
};
type Packet = { claims: any[]; relationships: any[] };

const VIEWS = [["chains", "Measurement chains"], ["document", "Source document"], ["ledger", "Claim ledger"], ["table83", "Verified Table 8.3"], ["raw", "Raw extraction"]] as const;
type View = typeof VIEWS[number][0];
const SCOPE_LABEL: Record<string, string> = { subject: "Subject-device column", shared: "Merged cell incl. subject column", comment: "Applicant comparison commentary", predicate: "Predicate column — not subject evidence", characteristic: "Table row label", document: "Summary narrative" };
const INTERP_LABEL: Record<string, string> = { explicit: "Explicit", normalized: "Normalized wording", inferred: "Inferred", "not stated": "Not stated", unreadable: "Unreadable", contradicted: "Contradicted" };

function basePath() { return typeof window !== "undefined" && window.location.pathname.startsWith("/evidence-explorer") ? "/evidence-explorer/" : "/"; }
function asset(path: string) { return `${basePath()}${path.replace(/^\//, "")}`; }
function today() { return new Date().toISOString().slice(0, 10); }
const idOf = (x: Item) => ("claim_id" in x ? x.claim_id : x.relationship_id);
const isClaim = (x: Item): x is Claim => "claim_id" in x;
const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(" ");
const slug = (s: string) => s.replaceAll(" ", "-");
function readDrafts(k: string): Record<string, Review> { try { return JSON.parse(localStorage.getItem(`evidence-review-v2-${k}`) || "{}"); } catch { return {}; } }
function writeDrafts(k: string, d: Record<string, Review>) { try { localStorage.setItem(`evidence-review-v2-${k}`, JSON.stringify(d)); } catch { /* storage unavailable */ } }
function download(value: unknown, name: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 1)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

export function ClearanceWorkspace({ kNumber, manifest }: { kNumber: string; manifest: { documents: { k_number: string; document: string }[]; review_packet: string; review_workbook: string } }) {
  const [raw, setRaw] = useState<V2Doc | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Review>>({});
  const [view, setView] = useState<View>("chains");
  const [selected, setSelected] = useState("");
  const [focusAnchor, setFocusAnchor] = useState<Anchor | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [notice, setNotice] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const entry = manifest.documents.find((d) => d.k_number === kNumber)!;
    Promise.all([
      fetch(asset(`evidence_data/v2/${entry.document}`)).then((r) => r.json()),
      fetch(asset(`evidence_data/v2/${manifest.review_packet}`)).then((r) => (r.ok ? r.json() : null)),
    ]).then(([d, p]) => {
      setRaw(d); setPacket(p); setDrafts(readDrafts(kNumber));
      const m = window.location.hash.match(/item=((?:CLM|REL)-[0-9a-f]+)/);
      if (m) setSelected(m[1]);
    })
      .catch((e) => setError(String(e)));
  }, [kNumber, manifest]);

  const canonical = useMemo(() => (raw ? applyReviews(raw, packet ? reviewsFromPacket(packet) : {}) as V2Doc : null), [raw, packet]);
  const doc = useMemo(() => (canonical ? applyReviews(canonical, drafts) as V2Doc : null), [canonical, drafts]);
  const items = useMemo(() => new Map<string, Item>(doc ? [...doc.claims, ...doc.relationships].map((x) => [idOf(x), x]) : []), [doc]);

  const open = useCallback((id: string, from?: HTMLElement | null) => {
    returnFocus.current = from ?? (document.activeElement as HTMLElement | null);
    setSelected(id);
    try { history.replaceState(null, "", `#item=${id}`); } catch { /* ignore */ }
  }, []);
  const close = useCallback(() => {
    setSelected("");
    try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
    returnFocus.current?.focus();
  }, []);
  const showInDocument = useCallback((a: Anchor) => {
    setFocusAnchor({ ...a }); setPdfPage(a.page); setView("document");
  }, []);

  const saveReview = (item: Item, review: Review) => {
    const next = { ...drafts, [idOf(item)]: review };
    setDrafts(next); writeDrafts(kNumber, next);
  };
  const discardDraft = (id: string) => { const next = { ...drafts }; delete next[id]; setDrafts(next); writeDrafts(kNumber, next); };

  if (error) return <main className="v2 v2Loading"><h1>Could not load the prototype record</h1><p>{error}</p></main>;
  if (!doc || !canonical) return <main className="v2 v2Loading"><div className="loadingMark" /><h1>Opening {kNumber}…</h1></main>;

  const d = doc.document;
  const prog = progress(doc);
  const draftCount = Object.keys(drafts).length;
  const exportDrafts = () => download({ schema_version: "2.0-prototype", packet_type: "evidence-review-v2-export", k_numbers: [kNumber], exported_at_utc: new Date().toISOString(),
    claims: doc.claims.filter((c) => drafts[c.claim_id]).map((c) => ({ claim_id: c.claim_id, normalized_value: c.normalized_value, evidence_fingerprint: c.evidence_fingerprint, ...drafts[c.claim_id] })),
    relationships: doc.relationships.filter((r) => drafts[r.relationship_id]).map((r) => ({ relationship_id: r.relationship_id, relation: r.relation, basis: r.basis, evidence_fingerprint: r.evidence_fingerprint, ...drafts[r.relationship_id] })) },
  `${kNumber}_review_v2_drafts.json`);
  const importJson = async (file?: File) => {
    if (!file || !packet) return;
    try {
      const incoming = JSON.parse(await file.text());
      const { errors, updates } = validateIncoming(packet, incoming);
      if (errors.length) { setNotice(`Import rejected (${errors.length} problem${errors.length > 1 ? "s" : ""}): ${errors.slice(0, 3).join(" · ")}`); return; }
      const next = { ...drafts, ...updates as Record<string, Review> };
      setDrafts(next); writeDrafts(kNumber, next); setNotice(`Imported ${Object.keys(updates).length} review record(s) as browser drafts.`);
    } catch (e) { setNotice(`Import failed: ${String(e)}`); }
  };
  const sel = selected ? items.get(selected) : undefined;

  return <main className={cls("v2", sel && "v2WithDrawer")}>
    <header className="v2Head">
      <a className="v2Back" href={asset("evidence/")}>← All clearances</a>
      <div className="v2Identity">
        <p className="v2Eyebrow">{d.product_code} · {d.document_type} · decision {d.decision_date} · {d.corpus} corpus</p>
        <h1><span>{d.k_number}</span> {d.device_name}</h1>
        <p>{d.applicant}{d.family_name ? <> · family <b>{d.family_name}</b> ({d.family_id}, provisional)</> : null}</p>
      </div>
      <div className="v2Source">
        <a href={d.source_url} target="_blank" rel="noreferrer">Original FDA PDF ↗</a>
        <a href={d.fda_detail_url} target="_blank" rel="noreferrer">FDA record ↗</a>
        <a href={`?view=legacy`}>Legacy page</a>
      </div>
    </header>
    <section className="v2Prov" aria-label="Provenance">
      <span><b>Retrieved</b> {d.retrieval_snapshot}</span>
      <span><b>SHA-256</b> <code title={d.sha256}>{d.sha256.slice(0, 16)}…</code></span>
      <span><b>Pages</b> {doc.pages.length} ({doc.pages.filter((p) => p.text_layer === "native").length} native text · {doc.pages.filter((p) => p.text_layer !== "native").length} image-only, local OCR)</span>
      <span><b>Structure</b> {doc.build.builder_version} · pdfplumber {doc.build.pdfplumber_version}</span>
    </section>
    <section className="v2Banner" role="note">
      <strong>Prototype record — not verified.</strong> Claims and links below are proposals ({doc.build.curation?.curator}). Only human-verified items can reach Table 8.3. A literal quote match does not verify a claim.
    </section>
    <section className="v2Progress" aria-label="Review progress">
      <div className="v2Meter" aria-hidden="true">{DECISIONS.map((k) => <i key={k} className={slug(k)} style={{ flexGrow: prog.by[k] }} />)}</div>
      <p><b>{prog.claims}</b> claims · <b>{prog.relationships}</b> links · {DECISIONS.filter((k) => prog.by[k]).map((k) => `${prog.by[k]} ${k}`).join(" · ")}{prog.stale ? ` · ${prog.stale} stale` : ""} · <b>{prog.countable}</b> count toward Table 8.3{draftCount ? <> · <em>{draftCount} unsaved browser draft{draftCount > 1 ? "s" : ""}</em></> : null}</p>
      <div className="v2Actions">
        <button onClick={exportDrafts} disabled={!draftCount}>Export drafts (JSON)</button>
        <button onClick={() => importRef.current?.click()}>Import JSON</button>
        <input ref={importRef} hidden type="file" accept="application/json" aria-label="Import review JSON" onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = ""; }} />
        <a href={asset(`evidence_data/v2/${manifest.review_workbook}`)} download>Workbook (XLSX)</a>
        <a href={asset(`evidence_data/v2/${manifest.review_packet}`)} download>Canonical packet</a>
      </div>
      {notice && <p className="v2Notice" role="status">{notice} <button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></p>}
    </section>
    <Tabs view={view} setView={setView} counts={{ chains: doc.chains.length, ledger: prog.total }} />
    <div className="v2Body">
      <div id={`panel-${view}`} role="tabpanel" aria-labelledby={`tab-${view}`} className="v2Panel">
        {view === "chains" && <ChainsView doc={doc} open={open} selected={selected} />}
        {view === "document" && <DocumentView doc={doc} focusAnchor={focusAnchor} pdfPage={pdfPage} setPdfPage={setPdfPage} open={open} />}
        {view === "ledger" && <LedgerView doc={doc} open={open} selected={selected} drafts={drafts} />}
        {view === "table83" && <Table83View canonical={canonical} doc={doc} draftCount={draftCount} />}
        {view === "raw" && <RawView doc={doc} />}
      </div>
      {sel && <Inspector key={idOf(sel)} item={sel} doc={doc} canonical={canonical} open={open} close={close} showInDocument={showInDocument}
        hasDraft={!!drafts[idOf(sel)]} save={(r) => saveReview(sel, r)} discard={() => discardDraft(idOf(sel))} />}
    </div>
    <footer className="evidenceFooter">Unofficial research transcription · FDA remains the ultimate regulatory source · No FDA endorsement implied · Browser drafts are local and not authoritative</footer>
  </main>;
}

function Tabs({ view, setView, counts }: { view: View; setView: (v: View) => void; counts: Record<string, number> }) {
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : -1;
    if (n < 0 && !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = VIEWS[(n + VIEWS.length) % VIEWS.length][0];
    setView(next);
    setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0);
  };
  return <div className="v2Tabs" role="tablist" aria-label="Clearance views">
    {VIEWS.map(([v, label], i) => <button key={v} id={`tab-${v}`} role="tab" aria-selected={view === v} aria-controls={`panel-${v}`} tabIndex={view === v ? 0 : -1}
      className={view === v ? "active" : ""} onClick={() => setView(v)} onKeyDown={(e) => onKey(e, i)}>{label}{counts[v] ? <b>{counts[v]}</b> : null}</button>)}
  </div>;
}

// ------------------------------------------------------------------ badges

function Decision({ item }: { item: Item }) {
  const stale = isStale(item);
  return <span className={cls("v2Decision", slug(item.review_decision || "pending"), stale && "stale")}>{stale ? "stale review" : item.review_decision || "pending"}</span>;
}
function StateBadge({ c }: { c: Claim }) {
  if (c.value_state !== "stated") return <span className="v2State gap">{c.value_state || "blank — not assessed"}</span>;
  if (c.polarity === "negated") return <span className="v2State negated">explicit exclusion</span>;
  return null;
}
function Interp({ v }: { v: string }) { return v ? <span className={cls("v2Interp", slug(v))}>{INTERP_LABEL[v] || v}</span> : null; }
function Basis({ b }: { b: string }) { return <span className={cls("v2Basis", b)}>{BASIS_LABELS[b as keyof typeof BASIS_LABELS] || b}</span>; }

function ClaimChip({ c, open, selected }: { c: Claim; open: (id: string, el?: HTMLElement | null) => void; selected: string }) {
  return <button className={cls("v2Chip", c.value_state !== "stated" && "gap", c.polarity === "negated" && "negated", selected === c.claim_id && "selected", c.aggregate === false && "component")}
    onClick={(e) => open(c.claim_id, e.currentTarget)} aria-label={`${FIELD_LABELS[c.field as keyof typeof FIELD_LABELS] || c.field}: ${effectiveValue(c)}. ${c.review_decision}. Open evidence.`}>
    <span className="v2ChipValue">{effectiveValue(c)}</span>
    {c.value_state !== "stated" && c.interpretation_note && <span className="v2ChipNote">{c.interpretation_note}</span>}
    <span className="v2ChipMeta">{c.value_state === "stated" && <Interp v={c.interpretation_v2} />}<StateBadge c={c} />{c.subject_scope && c.subject_scope !== "subject" && <span className="v2Scope">{c.subject_scope}</span>}{c.aggregate === false && <span className="v2Scope">component</span>}<Decision item={c} /></span>
  </button>;
}

// ------------------------------------------------------------------ chains

function ChainsView({ doc, open, selected }: { doc: V2Doc; open: (id: string, el?: HTMLElement | null) => void; selected: string }) {
  const byId = new Map(doc.claims.map((c) => [c.claim_id, c]));
  const measurement = doc.chains.filter((c) => c.kind !== "report");
  const report = doc.chains.find((c) => c.kind === "report");
  return <div className="v2Chains">
    <div className="v2Intro">
      <h2>Device measurement architecture</h2>
      <p>Each chain runs <em>physical sensor → location → raw signal → physiological parameter → direct/derived → feature → output</em>. Every value is its own claim with its own evidence, and every arrow is a separately reviewable link. A link marked <Basis b="not-stated" /> is a recorded gap, not a missing extraction.</p>
    </div>
    <div className="v2ChainGrid">
      {measurement.map((ch) => <ChainCard key={ch.chain_id} ch={ch} doc={doc} byId={byId} open={open} selected={selected} />)}
    </div>
    {report && <ReportCard ch={report} doc={doc} byId={byId} open={open} selected={selected} />}
  </div>;
}

function LinkButton({ r, byId, open, selected, dir }: { r: Relationship; byId: Map<string, Claim>; open: (id: string, el?: HTMLElement | null) => void; selected: string; dir?: "in" | "out" }) {
  const a = byId.get(r.from_claim_id), b = byId.get(r.to_claim_id);
  return <button className={cls("v2Link", r.basis, selected === r.relationship_id && "selected")} onClick={(e) => open(r.relationship_id, e.currentTarget)}
    aria-label={`Link: ${a && effectiveValue(a)} ${RELATION_LABELS[r.relation as keyof typeof RELATION_LABELS]} ${b && effectiveValue(b)}. ${BASIS_LABELS[r.basis as keyof typeof BASIS_LABELS]}. ${r.review_decision}.`}>
    <span className="v2LinkText">{dir === "in" ? "←" : "→"} {RELATION_LABELS[r.relation as keyof typeof RELATION_LABELS]} <em>{dir === "in" ? a && effectiveValue(a) : b && effectiveValue(b)}</em></span>
    <span className="v2ChipMeta"><Basis b={r.basis} /><Decision item={r} /></span>
  </button>;
}

function ChainCard({ ch, doc, byId, open, selected }: { ch: Chain; doc: V2Doc; byId: Map<string, Claim>; open: (id: string, el?: HTMLElement | null) => void; selected: string }) {
  const rels = doc.relationships.filter((r) => r.chain_id === ch.chain_id);
  const row = (f: string) => {
    const ids = ch.slots[f]?.claim_ids || [];
    const claims = ids.map((id) => byId.get(id)).filter(Boolean) as Claim[];
    const out = rels.filter((r) => ids.includes(r.from_claim_id) && CHAIN_FIELDS.indexOf(byId.get(r.to_claim_id)?.field || "") >= 0 && byId.get(r.to_claim_id)?.field !== f);
    return <tr key={f}>
      <th scope="row">{FIELD_LABELS[f as keyof typeof FIELD_LABELS]}</th>
      <td>{claims.length ? claims.map((c) => <ClaimChip key={c.claim_id} c={c} open={open} selected={selected} />) : <span className="v2Blank" title="Blank means this field was not assessed; it is not the same as Not stated">blank — not assessed</span>}</td>
      <td className="v2Links">{out.map((r) => <LinkButton key={r.relationship_id} r={r} byId={byId} open={open} selected={selected} />)}</td>
    </tr>;
  };
  const unlinked = doc.relationships.filter((r) => r.chain_id === ch.chain_id && r.basis === "not-stated" && byId.get(r.from_claim_id)?.field === "diagnostic_output");
  const supplementary = SUPPLEMENTARY_FIELDS.filter((f) => ch.slots[f]?.claim_ids.length);
  return <article className="v2Chain" aria-labelledby={`h-${ch.chain_id}`}>
    <header><h3 id={`h-${ch.chain_id}`}>{ch.label}</h3><p>{ch.summary}</p><code>{ch.chain_id}</code></header>
    {ch.caveats.length > 0 && <ul className="v2Caveats">{ch.caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
    <table className="v2Ladder"><thead><tr><th scope="col">Field</th><th scope="col">Proposed claim(s)</th><th scope="col">Links from this field</th></tr></thead>
      <tbody>{CHAIN_FIELDS.map(row)}</tbody></table>
    {unlinked.length > 0 && <p className="v2Unlinked"><b>Outputs whose link to this parameter is not stated:</b> {unlinked.map((r) => <button key={r.relationship_id} className="v2TextBtn" onClick={(e) => open(r.relationship_id, e.currentTarget)}>{effectiveValue(byId.get(r.from_claim_id)!)}</button>)}</p>}
    {supplementary.length > 0 && <details className="v2Supp"><summary>Also documented for Table 8.4 (Section 8.2 fields: {supplementary.length})</summary>
      <table className="v2Ladder"><tbody>{supplementary.map((f) => <tr key={f}><th scope="row">{FIELD_LABELS[f as keyof typeof FIELD_LABELS]}</th><td colSpan={2}>{ch.slots[f].claim_ids.map((id) => byId.get(id)).filter(Boolean).map((c) => <ClaimChip key={c!.claim_id} c={c!} open={open} selected={selected} />)}</td></tr>)}</tbody></table>
    </details>}
  </article>;
}

function ReportCard({ ch, doc, byId, open, selected }: { ch: Chain; doc: V2Doc; byId: Map<string, Claim>; open: (id: string, el?: HTMLElement | null) => void; selected: string }) {
  const outputs = [...ch.slots.diagnostic_output.claim_ids, ...ch.slots.derived_reported_feature.claim_ids].map((id) => byId.get(id)).filter(Boolean) as Claim[];
  const inputs = (id: string) => doc.relationships.filter((r) => r.from_claim_id === id && ["derived_feature_of", "reported_as"].includes(r.relation));
  return <article className="v2Chain v2Report" aria-labelledby={`h-${ch.chain_id}`}>
    <header><h3 id={`h-${ch.chain_id}`}>{ch.label}</h3><p>{ch.summary}</p><code>{ch.chain_id}</code></header>
    <ul className="v2Caveats">{ch.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
    <table className="v2Ladder v2Outputs"><thead><tr><th scope="col">Output / feature</th><th scope="col">Field</th><th scope="col">Link to a physiological parameter</th></tr></thead>
      <tbody>{outputs.map((c) => { const ins = inputs(c.claim_id); return <tr key={c.claim_id}>
        <td><ClaimChip c={c} open={open} selected={selected} /></td>
        <td className="v2Muted">{FIELD_LABELS[c.field as keyof typeof FIELD_LABELS]}</td>
        <td className="v2Links">{ins.length ? ins.map((r) => <LinkButton key={r.relationship_id} r={r} byId={byId} open={open} selected={selected} />) : <span className="v2Blank">no link proposed</span>}</td>
      </tr>; })}</tbody></table>
    {ch.slots.validation_comparator?.claim_ids.length > 0 && <p className="v2Unlinked"><b>Validation:</b> {ch.slots.validation_comparator.claim_ids.map((id) => <ClaimChip key={id} c={byId.get(id)!} open={open} selected={selected} />)}</p>}
  </article>;
}

// ------------------------------------------------------------------ text rendering with offsets

type Deco = { start: number; end: number; className: string; title?: string };
function keepBreaks(lines: Line[], preserve: boolean) {
  const keep = new Set<number>(); let pos = 0;
  lines.forEach((l, i) => {
    if (i > 0) { if (preserve || l.para_break || /^[-•]\s/.test(l.text)) keep.add(pos - 1); }
    pos += l.text.length + 1;
  });
  return keep;
}
function TextRun({ text, lines, decos, preserve }: { text: string; lines: Line[]; decos: Deco[]; preserve?: boolean }) {
  const keep = keepBreaks(lines, !!preserve);
  const cuts = new Set([0, text.length]);
  for (const d of decos) { cuts.add(Math.max(0, d.start)); cuts.add(Math.min(text.length, d.end)); }
  keep.forEach((i) => { cuts.add(i); cuts.add(i + 1); });
  const pts = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    let piece = text.slice(s, e);
    if (piece === "\n" && keep.has(s)) { out.push(<br key={s} />); continue; }
    piece = piece.replace(/-\n(?=[a-z])/g, "-").replace(/\n/g, " ");
    const ds = decos.filter((d) => d.start <= s && d.end >= e);
    let node: ReactNode = piece;
    for (const d of ds) node = d.className === "hit" ? <mark key={d.className} className="v2Mark">{node}</mark> : <span key={d.className} className={d.className} title={d.title}>{node}</span>;
    out.push(<Fragment key={s}>{node}</Fragment>);
  }
  return <>{out}</>;
}
function ocrDecos(lines: Line[]): Deco[] {
  return lines.flatMap((l) => (l.ocr_words || []).filter(([, , c]) => c < 80).map(([s, e, c]) => ({ start: s, end: e, className: "v2LowConf", title: `OCR confidence ${c}%` })));
}

// ------------------------------------------------------------------ document

function DocumentView({ doc, focusAnchor, pdfPage, setPdfPage, open }: { doc: V2Doc; focusAnchor: Anchor | null; pdfPage: number; setPdfPage: (n: number) => void; open: (id: string, el?: HTMLElement | null) => void }) {
  const [showPdf, setShowPdf] = useState(true);
  const [follow, setFollow] = useState(true);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const suppressFollow = useRef(0);
  useEffect(() => {
    if (!focusAnchor) return;
    suppressFollow.current = Date.now() + 1200;
    const t = setTimeout(() => document.getElementById(`u-${focusAnchor.target.id}`)?.scrollIntoView({ block: "center", inline: "center" }), 30);
    return () => clearTimeout(t);
  }, [focusAnchor]);
  const cited = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const x of [...doc.claims, ...doc.relationships]) for (const a of x.evidence || []) { const l = m.get(a.target.id) || []; if (!l.includes(x)) l.push(x); m.set(a.target.id, l); }
    return m;
  }, [doc]);
  useEffect(() => {
    if (!follow || !readerRef.current) return;
    const els = [...readerRef.current.querySelectorAll<HTMLElement>("[data-page]")];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis && Date.now() > suppressFollow.current) setPdfPage(Number(vis.target.getAttribute("data-page")));
    }, { root: readerRef.current, rootMargin: "0px 0px -70% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [follow, setPdfPage, doc]);
  const jumpTo = useCallback((page: number) => { suppressFollow.current = Date.now() + 800; setPdfPage(page); readerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.scrollIntoView({ block: "start" }); }, [setPdfPage]);
  const decosFor = (id: string, lines: Line[]): Deco[] => {
    const ds = ocrDecos(lines);
    if (focusAnchor?.target.id === id) ds.push({ start: focusAnchor.char_start, end: focusAnchor.char_end, className: "hit" });
    return ds;
  };
  const sectionsByPart = (pid: string) => doc.sections.filter((s) => s.part_id === pid);
  const blocksById = new Map(doc.blocks.map((b) => [b.block_id, b]));
  const comparison = doc.tables.find((t) => t.kind === "comparison");
  const orderedBlocks = (pid: string) => doc.blocks.filter((b) => doc.sections.find((s) => s.section_id === b.section_id)?.part_id === pid).sort((a, b) => a.page - b.page || a.order - b.order);
  const marks = new Set<string>();
  {
    let prev = 0;
    for (const part of doc.parts) for (const b of orderedBlocks(part.part_id)) {
      if (b.type === "table_ref") { const t = doc.tables.find((x) => x.table_id === b.table_id); if (b.page !== prev) marks.add(b.block_id); prev = t?.pages.at(-1) ?? prev; continue; }
      if (b.page !== prev) marks.add(b.block_id);
      prev = b.page;
    }
  }
  const pageMark = (p: number) => {
    const pg = doc.pages[p - 1];
    const arts = doc.artifacts.filter((a) => a.page === p && a.text);
    return <div className="v2PageMark" data-page={p} key={`pm-${p}`}>
      <span>PDF page {p}{pg.page_label ? ` · printed “${pg.page_label}”` : ""}</span>
      {pg.text_layer !== "native" && <span className="v2Warn">Image-only page · text below is local OCR ({pg.ocr?.engine}, mean confidence {pg.ocr?.mean_conf}%, {pg.ocr?.low_conf_words} low-confidence words) — unreviewed</span>}
      {showArtifacts && arts.length > 0 && <span className="v2Arts">Page furniture: {arts.map((a) => `${a.role.replace("_", " ")} “${a.text}”`).join(" · ")}</span>}
    </div>;
  };
  const Cites = ({ id }: { id: string }) => {
    const list = cited.get(id);
    if (!list) return null;
    return <details className="v2Cites"><summary aria-label={`${list.length} claims or links cite this passage`}>{list.length}</summary>
      <ul>{list.map((x) => <li key={idOf(x)}><button className="v2TextBtn" onClick={(e) => open(idOf(x), e.currentTarget)}>{isClaim(x) ? `${FIELD_LABELS[x.field as keyof typeof FIELD_LABELS] || x.field}: ${effectiveValue(x)}` : `Link: ${RELATION_LABELS[x.relation as keyof typeof RELATION_LABELS]}`}</button></li>)}</ul></details>;
  };
  const renderBlock = (b: Block): ReactNode => {
    if (b.type === "table_ref") {
      const t = doc.tables.find((x) => x.table_id === b.table_id)!;
      return <TableView key={b.block_id} t={t} decosFor={decosFor} Cites={Cites} />;
    }
    const pm = marks.has(b.block_id) ? pageMark(b.page) : null;
    const inner = <TextRun text={b.text} lines={b.lines} decos={decosFor(b.block_id, b.lines)} preserve={b.preserve_lines} />;
    const common = { id: `u-${b.block_id}`, className: cls("v2Unit", `t-${b.type}`, focusAnchor?.target.id === b.block_id && "focused", cited.has(b.block_id) && "cited", b.text_layer !== "native" && "ocr") };
    let el: ReactNode;
    if (b.type === "heading") el = b.level === 1 ? <h3 {...common}>{inner}</h3> : <h4 {...common}>{inner}</h4>;
    else if (b.type === "list_item") el = <div {...common} role="listitem" style={{ marginLeft: `${(b.level || 1) * 18}px` }}><span aria-hidden="true" className="v2Bullet">{b.level === 2 ? "◦" : "•"}</span>{inner}</div>;
    else el = <div {...common}>{b.lead_in ? <strong className="v2LeadIn">{inner}</strong> : inner}{b.layout_note && <small className="v2Note">{b.layout_note}</small>}</div>;
    return <Fragment key={b.block_id}>{pm}<div className="v2UnitRow">{el}<Cites id={b.block_id} /></div></Fragment>;
  };
  return <div className={cls("v2Doc", showPdf && "withPdf")}>
    <nav className="v2Outline" aria-label="Document outline">
      <h2>Outline</h2>
      {doc.parts.map((p) => <div key={p.part_id} className="v2OutlinePart">
        <p className="v2OutlinePartTitle">{p.title}<small>pp. {p.pages[0]}–{p.pages.at(-1)}{p.title_source !== "source" ? " · title " + p.title_source : ""}</small></p>
        <ul>{sectionsByPart(p.part_id).filter((s) => s.level > 0).map((s) => <li key={s.section_id} style={{ paddingLeft: (s.level - 1) * 10 }}>
          <button className="v2TextBtn" onClick={() => { const first = s.block_ids.map((id) => blocksById.get(id)).find(Boolean); if (first) { document.getElementById(first.type === "table_ref" ? `u-${first.table_id}` : `u-${first.block_id}`)?.scrollIntoView({ block: "start" }); setPdfPage(s.page_start); } }}>{s.title}</button>
          {comparison && s.block_ids.includes(`${comparison.table_id}-REF`) && <ul>{comparison.rows.map((r) => <li key={r.row_id}><button className="v2TextBtn v2Sub" onClick={() => { document.getElementById(`u-${r.row_id}`)?.scrollIntoView({ block: "center" }); setPdfPage(r.pages[0]); }}>{r.label}</button></li>)}</ul>}
        </li>)}</ul>
      </div>)}
      <h2>Pages</h2>
      <div className="v2PageGrid">{doc.pages.map((p) => <button key={p.page} className={cls(pdfPage === p.page && "active", p.text_layer !== "native" && "ocr")} onClick={() => jumpTo(p.page)} aria-label={`Go to PDF page ${p.page}${p.text_layer !== "native" ? " (image-only, OCR)" : ""}`}>{p.page}</button>)}</div>
      <label className="v2Check"><input type="checkbox" checked={showArtifacts} onChange={(e) => setShowArtifacts(e.target.checked)} /> Show page furniture</label>
      <label className="v2Check"><input type="checkbox" checked={showPdf} onChange={(e) => setShowPdf(e.target.checked)} /> Show PDF page</label>
      <label className="v2Check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> PDF follows reading position</label>
    </nav>
    {/* A scrollable region must be keyboard-focusable (WCAG 2.1.1). */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="v2Reader" ref={readerRef} tabIndex={0} role="region" aria-label="Reconstructed FDA document">
      {doc.parts.map((p) => <section key={p.part_id} className={cls("v2Part", `k-${p.kind}`)} aria-label={p.title}>
        <p className="v2PartLabel">{p.kind === "letter" ? "FDA correspondence" : p.kind === "ifu_form" ? "FDA form (image-only page)" : "Applicant 510(k) summary"} · {p.title}</p>
        {orderedBlocks(p.part_id).map((b) => b.type === "table_ref" && marks.has(b.block_id) ? <Fragment key={b.block_id}>{pageMark(b.page)}{renderBlock(b)}</Fragment> : renderBlock(b))}
      </section>)}
    </div>
    {showPdf && <PdfPane doc={doc} page={pdfPage} setPage={jumpTo} anchor={focusAnchor} />}
  </div>;
}

function TableView({ t, decosFor, Cites }: { t: Table; decosFor: (id: string, lines: Line[]) => Deco[]; Cites: (p: { id: string }) => ReactNode }) {
  const roleOf = Object.fromEntries(t.columns.map((c) => [c.col_id, c.role]));
  const groups: { label: string; span: number; role: string }[] = [];
  for (const c of t.columns) { const g = c.group || ""; const last = groups.at(-1); if (last && last.label === g && g) last.span++; else groups.push({ label: g, span: 1, role: c.role }); }
  const cellLines = (c: Cell) => c.segments.flatMap((s) => s.lines);
  return <div className="v2TableWrap" id={`u-${t.table_id}`}>
    <p className="v2TableMeta"><b>{t.title}</b> · {t.kind === "comparison" ? `pp. ${t.pages[0]}–${t.pages.at(-1)}, header repeated on ${t.pages.length - 1} continuation pages (shown once)` : `p. ${t.pages[0]}`} · structure: {t.structure_confidence} confidence ({t.structure_method})</p>
    <table className={cls("v2SrcTable", `k-${t.kind}`)}>
      {t.kind === "comparison" && <colgroup>{t.columns.map((c) => <col key={c.col_id} className={`r-${c.role}`} />)}</colgroup>}
      {t.kind === "comparison" && <thead>
        <tr>{groups.map((g, i) => <th key={i} colSpan={g.span} scope="colgroup" className={`r-${g.role}`}>{g.label}</th>)}</tr>
        <tr>{t.columns.map((c) => <th key={c.col_id} scope="col" className={`r-${c.role}`}>{c.label}{c.role === "subject" && <span className="v2ColTag">subject device</span>}{c.role === "predicate" && <span className="v2ColTag">predicate — not subject evidence</span>}</th>)}</tr>
      </thead>}
      <tbody>{t.rows.map((r, ri) => {
        const prevPage = ri ? t.rows[ri - 1].pages.at(-1) : r.pages[0];
        return <Fragment key={r.row_id}>
          {ri > 0 && r.pages[0] !== prevPage && <tr className="v2PageRow" data-page={r.pages[0]}><td colSpan={t.columns.length}>PDF page {r.pages[0]} begins (column headers repeated in source)</td></tr>}
          <tr id={`u-${r.row_id}`} data-page={r.pages[0]}>
          {r.cells.map((c) => {
            const lines = cellLines(c);
            const Tag = c.col_ids[0] === t.columns[0].col_id ? "th" : "td";
            const roles = [...new Set(c.col_ids.map((id) => roleOf[id]))];
            return <Tag key={c.cell_id} id={`u-${c.cell_id}`} scope={Tag === "th" ? "row" : undefined} colSpan={c.col_ids.length > 1 ? c.col_ids.length : undefined}
              className={cls(`r-${roles.includes("subject") ? "subject" : roles[0]}`, c.col_ids.length > 1 && "merged", "v2Unit")}>
              <div className="v2CellInner"><TextRun text={c.text} lines={lines} decos={decosFor(c.cell_id, lines)} /><Cites id={c.cell_id} /></div>
              {Tag === "th" && r.pages.length > 1 && <small className="v2RowPages">continues pp. {r.pages.join("–")}</small>}
              {Tag === "th" && r.pages.length === 1 && t.kind === "comparison" && <small className="v2RowPages">p. {r.pages[0]}</small>}
              {c.col_ids.length > 1 && <small className="v2Merged">merged: {c.col_ids.map((id) => t.columns.find((x) => x.col_id === id)?.device || id).join(" + ")}</small>}
            </Tag>;
          })}
        </tr>
          {r.pages.length > 1 && <tr className="v2PageRow" data-page={r.pages.at(-1)}><td colSpan={t.columns.length}>Row “{r.label}” continues from PDF page {r.pages[0]} onto page {r.pages.slice(1).join(", ")}; cell text joined in reading order</td></tr>}
        </Fragment>;
      })}</tbody>
    </table>
  </div>;
}

function PageImage({ doc, page, anchor, scaleTo }: { doc: V2Doc; page: number; anchor: Anchor | null; scaleTo?: number }) {
  const pg = doc.pages[page - 1];
  const boxes = anchor ? anchor.bboxes.filter((b) => b.page === page) : [];
  return <div className="v2PageImg" style={scaleTo ? { width: scaleTo } : undefined}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={asset(`evidence_data/v2/${pg.render}`)} alt={`Render of FDA PDF page ${page} of ${doc.pages.length}`} loading="lazy" />
    {boxes.map((b, i) => <span key={i} className="v2Box" style={{ left: `${(b.x0 - 2) / pg.width * 100}%`, top: `${(b.top - 2) / pg.height * 100}%`, width: `${(b.x1 - b.x0 + 4) / pg.width * 100}%`, height: `${(b.bottom - b.top + 4) / pg.height * 100}%` }} />)}
  </div>;
}

function PdfPane({ doc, page, setPage, anchor }: { doc: V2Doc; page: number; setPage: (n: number) => void; anchor: Anchor | null }) {
  const [zoom, setZoom] = useState(1);
  const pg = doc.pages[page - 1];
  return <aside className="v2Pdf" aria-label="Source PDF page">
    <div className="v2PdfBar">
      <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">‹</button>
      <span>PDF p. {page} / {doc.pages.length}{pg.page_label ? <small> · {pg.page_label}</small> : null}</span>
      <button onClick={() => setPage(Math.min(doc.pages.length, page + 1))} disabled={page >= doc.pages.length} aria-label="Next page">›</button>
      <label>Zoom <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[1, 1.5, 2, 3].map((z) => <option key={z} value={z}>{z === 1 ? "Fit" : `${z * 100}%`}</option>)}</select></label>
      <a href={`${doc.document.source_url}#page=${page}`} target="_blank" rel="noreferrer">FDA PDF ↗</a>
    </div>
    <div className="v2PdfScroll"><div style={{ width: `${zoom * 100}%` }}><PageImage doc={doc} page={page} anchor={anchor} /></div></div>
    <p className="v2PdfNote">{pg.text_layer === "native" ? "Page render of the FDA PDF (110 dpi). Highlights show the selected evidence." : "Image-only page: the transcript on the left is local OCR and has not been reviewed."}</p>
  </aside>;
}

function PdfCrop({ doc, anchor }: { doc: V2Doc; anchor: Anchor }) {
  const W = 360;
  return <div className="v2Crops">{anchor.pages.map((p) => {
    const pg = doc.pages[p - 1];
    const bs = anchor.bboxes.filter((b) => b.page === p);
    if (!bs.length) return null;
    const m = 14;
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.x0)) - m), x1 = Math.min(pg.width, Math.max(...bs.map((b) => b.x1)) + m);
    const y0 = Math.max(0, Math.min(...bs.map((b) => b.top)) - m), y1 = Math.min(pg.height, Math.max(...bs.map((b) => b.bottom)) + m);
    const s = Math.min(W / (x1 - x0), 2.2);
    return <figure key={p} className="v2Crop">
      <div className="v2CropBox" style={{ width: (x1 - x0) * s, height: (y1 - y0) * s }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset(`evidence_data/v2/${pg.render}`)} alt="" style={{ width: pg.width * s, left: -x0 * s, top: -y0 * s }} />
        {bs.map((b, i) => <span key={i} className="v2Box" style={{ left: (b.x0 - x0 - 2) * s, top: (b.top - y0 - 2) * s, width: (b.x1 - b.x0 + 4) * s, height: (b.bottom - b.top + 4) * s }} />)}
      </div>
      <figcaption>PDF page {p} — crop of the page render around the quoted words</figcaption>
    </figure>;
  })}</div>;
}

// ------------------------------------------------------------------ inspector

function AnchorCard({ a, doc, showInDocument }: { a: Anchor; doc: V2Doc; showInDocument: (a: Anchor) => void }) {
  const section = doc.sections.find((s) => s.section_id === a.section_id);
  const table = a.target.table_id ? doc.tables.find((t) => t.table_id === a.target.table_id) : undefined;
  const cols = a.target.col_ids?.map((id) => table?.columns.find((c) => c.col_id === id)?.label || id).join(" + ");
  const q = a.exact_quote;
  const vs = a.value_span;
  return <li className={cls("v2Anchor", `role-${a.role}`, `scope-${a.scope}`)}>
    <div className="v2AnchorHead">
      <span className="v2Role">{a.role}</span>
      <span className={cls("v2ScopeTag", a.scope)}>{SCOPE_LABEL[a.scope] || a.scope}</span>
      {a.text_layer !== "native" && <span className="v2Warn">local OCR{a.ocr_min_conf != null ? ` · min confidence ${a.ocr_min_conf}%` : ""}</span>}
    </div>
    <blockquote>{vs ? <>{q.slice(0, vs[0])}<mark className="v2Mark">{q.slice(vs[0], vs[1])}</mark>{q.slice(vs[1])}</> : q}</blockquote>
    <p className="v2Where">PDF p. {a.pages.join("–")} · {section?.title}{table ? <> › {table.title} › row “{a.target.row_label}” › {cols}</> : null}<br /><code>{a.target.id}</code> · chars {a.char_start}–{a.char_end}</p>
    {a.note && <p className="v2Note">{a.note}</p>}
    <PdfCrop doc={doc} anchor={a} />
    <button className="v2Btn" onClick={() => showInDocument(a)}>Show in document and PDF</button>
  </li>;
}

function Inspector({ item, doc, canonical, open, close, showInDocument, hasDraft, save, discard }: {
  item: Item; doc: V2Doc; canonical: V2Doc; open: (id: string, el?: HTMLElement | null) => void; close: () => void;
  showInDocument: (a: Anchor) => void; hasDraft: boolean; save: (r: Review) => void; discard: () => void;
}) {
  const headRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<Review>({ review_decision: item.review_decision || "pending", reviewed_value: item.reviewed_value || "", reviewed_category: item.reviewed_category || "",
    reviewer: item.reviewer || "", reviewer_date: item.reviewer_date || "", reviewer_notes: item.reviewer_notes || "", reviewed_evidence_fingerprint: item.reviewed_evidence_fingerprint || "" });
  const [saved, setSaved] = useState("");
  useEffect(() => { headRef.current?.focus(); }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [close]);
  const errs = reviewErrors(item, form);
  const claim = isClaim(item) ? item : null;
  const rel = isClaim(item) ? null : item;
  const byId = new Map(doc.claims.map((c) => [c.claim_id, c]));
  const canonItem = [...canonical.claims, ...canonical.relationships].find((x) => idOf(x) === idOf(item));
  const links = claim ? doc.relationships.filter((r) => r.from_claim_id === claim.claim_id || r.to_claim_id === claim.claim_id) : [];
  const chains = claim ? doc.chains.filter((ch) => Object.values(ch.slots).some((s) => s.claim_ids.includes(claim.claim_id))) : [];
  const record = () => {
    if (errs.length) return;
    const r = { ...form, reviewer_date: form.review_decision === "pending" ? "" : form.reviewer_date || today(), reviewed_evidence_fingerprint: form.review_decision === "pending" ? "" : item.evidence_fingerprint };
    save(r); setForm(r); setSaved("Saved as a browser draft. Export the drafts, or use the workbook, to make it authoritative.");
  };
  const choose = (d: string) => { setForm({ ...form, review_decision: d }); setSaved(""); };
  const title = claim ? FIELD_LABELS[claim.field as keyof typeof FIELD_LABELS] || claim.field : `Link: ${RELATION_LABELS[rel!.relation as keyof typeof RELATION_LABELS]}`;
  return <aside className="v2Drawer" aria-labelledby="v2DrawerTitle">
    <header>
      <div><p className="v2Eyebrow">{claim ? (claim.origin === "v1-extraction" ? "v1 extracted claim" : "prototype curation proposal") : "measurement-chain link"}</p>
        <h2 id="v2DrawerTitle" ref={headRef} tabIndex={-1}>{title}</h2><code>{idOf(item)}</code></div>
      <button className="v2Close" onClick={close} aria-label="Close inspector (Escape)">×</button>
    </header>
    <div className="v2DrawerBody">
      {claim && <section className="v2Value">
        <dl>
          <dt>Proposed normalized value</dt><dd className="v2Big">{claim.normalized_value}<StateBadge c={claim} /></dd>
          {claim.category && <><dt>Table 8.3 category</dt><dd>{claim.category}{claim.aggregate === false && <span className="v2Scope">excluded from Table 8.3</span>}</dd></>}
          {claim.aggregate_note && <><dt>Aggregation note</dt><dd>{claim.aggregate_note}</dd></>}
          <dt>Source wording</dt><dd>{claim.source_value ? `“${claim.source_value}”` : <span className="v2Muted">none — {claim.value_state || "blank"}</span>}</dd>
          <dt>Interpretation</dt><dd><Interp v={claim.interpretation_v2} /> {claim.interpretation_note}</dd>
          {chains.length > 0 && <><dt>Chains</dt><dd>{chains.map((c) => c.label).join(" · ")}</dd></>}
          <dt>Literal text match</dt><dd><span className="v2Muted">{claim.evidence_text_match}. A literal match only shows the words occur; it does not verify the claim.</span></dd>
        </dl>
      </section>}
      {rel && <section className="v2Value">
        <p className="v2RelLine"><button className="v2TextBtn" onClick={(e) => open(rel.from_claim_id, e.currentTarget)}>{effectiveValue(byId.get(rel.from_claim_id)!)}</button>
          <span> {RELATION_LABELS[rel.relation as keyof typeof RELATION_LABELS]} </span>
          <button className="v2TextBtn" onClick={(e) => open(rel.to_claim_id, e.currentTarget)}>{effectiveValue(byId.get(rel.to_claim_id)!)}</button></p>
        <p><Basis b={rel.basis} /> {rel.note}</p>
        <p className="v2Muted">Chain {doc.chains.find((c) => c.chain_id === rel.chain_id)?.label}</p>
      </section>}
      {claim?.legacy_assessment && claim.origin === "v1-extraction" && <section className="v2Legacy">
        <h3>Prototype assessment of the v1 claim</h3>
        <p><b>{claim.legacy_assessment.verdict}</b> → recommended: <b>{claim.legacy_assessment.recommended_action}</b></p>
        <p>{claim.legacy_assessment.note}</p>
        {claim.legacy_assessment.suggested_reviewed_value && <p>Suggested reviewed value: “{claim.legacy_assessment.suggested_reviewed_value}”</p>}
        {!!claim.legacy_assessment.superseded_by?.length && <p>Proposed replacement(s): {claim.legacy_assessment.superseded_by.map((ref) => { const c = doc.claims.find((x) => x.curation_ref === ref); return c ? <button key={ref} className="v2TextBtn" onClick={(e) => open(c.claim_id, e.currentTarget)}>{c.normalized_value}</button> : null; })}</p>}
        <details><summary>v1 excerpt as originally extracted ({claim.evidence_text_match} text match, block {claim.block_id})</summary><blockquote className="v2LegacyQuote">{claim.supporting_excerpt || "none"}</blockquote></details>
      </section>}
      <section>
        <h3>Evidence ({item.evidence.length})</h3>
        {item.evidence.length ? <ol className="v2Anchors">{item.evidence.map((a) => <AnchorCard key={a.anchor_id} a={a} doc={doc} showInDocument={showInDocument} />)}</ol>
          : <p className="v2Muted">No source passage. {claim?.value_state === "Not stated" ? "This records that the document does not state the value." : rel?.basis === "not-stated" ? "This records that the document does not state the link." : "No evidence has been anchored."}</p>}
        {claim?.absence_check && <div className="v2Absence"><h4>Absence check</h4>
          <p>Searched {claim.absence_check.searched} for: {claim.absence_check.terms.map((t) => <code key={t}>{t}</code>)}.</p>
          <p><b>{claim.absence_check.subject_hit_count}</b> hits outside predicate columns · {claim.absence_check.hit_count} total.</p>
          {claim.absence_check.hits.length > 0 && <ul>{claim.absence_check.hits.map((h, i) => <li key={i}><span className={cls("v2ScopeTag", h.scope)}>{SCOPE_LABEL[h.scope] || h.scope}</span> p. {h.page} “…{h.context}…”</li>)}</ul>}
        </div>}
      </section>
      {links.length > 0 && <section><h3>Links ({links.length})</h3><div className="v2LinkList">{links.map((r) => <LinkButton key={r.relationship_id} r={r} byId={byId} open={open} selected="" dir={r.to_claim_id === claim!.claim_id ? "in" : "out"} />)}</div></section>}
      <section className="v2ReviewForm" aria-labelledby="v2ReviewHead">
        <h3 id="v2ReviewHead">Review decision</h3>
        {isStale(item) && <p className="v2Warn">The evidence changed after this review was recorded. The decision no longer counts until it is re-confirmed.</p>}
        <p className="v2Muted">Canonical: <Decision item={canonItem || item} />{hasDraft && <> · this browser has a draft</>}</p>
        <fieldset><legend className="v2Sr">Decision</legend>
          <div className="v2Seg">{DECISIONS.map((dcs) => <label key={dcs} className={cls(form.review_decision === dcs && "on", slug(dcs))}>
            <input type="radio" name="decision" value={dcs} checked={form.review_decision === dcs} onChange={() => choose(dcs)} disabled={rel?.basis === "not-stated" && (dcs === "verified" || dcs === "edited and verified")} />
            {dcs === "verified" ? "Accept" : dcs === "edited and verified" ? "Edit & verify" : dcs === "needs clarification" ? "Clarify" : dcs === "rejected" ? "Reject" : "Pending"}</label>)}</div>
        </fieldset>
        {claim && form.review_decision === "edited and verified" && <div className="v2Grid2">
          <label>Corrected value<input value={form.reviewed_value} placeholder={claim.legacy_assessment?.suggested_reviewed_value || claim.normalized_value} onChange={(e) => setForm({ ...form, reviewed_value: e.target.value })} /></label>
          <label>Corrected Table 8.3 category<input value={form.reviewed_category} placeholder={claim.category} onChange={(e) => setForm({ ...form, reviewed_category: e.target.value })} /></label>
        </div>}
        <div className="v2Grid2">
          <label>Reviewer<input value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} placeholder="initials" /></label>
          <label>Date<input type="date" value={form.reviewer_date} onChange={(e) => setForm({ ...form, reviewer_date: e.target.value })} /></label>
        </div>
        <label>Notes{requiresNote(item) ? " (required to verify an inferred item)" : ""}<textarea value={form.reviewer_notes} onChange={(e) => setForm({ ...form, reviewer_notes: e.target.value })} rows={3} /></label>
        {errs.length > 0 && <ul className="v2Errors" role="alert">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="v2FormActions"><button className="v2Btn primary" onClick={record} disabled={errs.length > 0}>Record decision</button>
          {hasDraft && <button className="v2Btn" onClick={() => { discard(); setSaved("Draft discarded."); }}>Discard draft</button>}</div>
        {saved && <p role="status" className="v2Muted">{saved}</p>}
        <p className="v2Muted">Evidence fingerprint <code>{item.evidence_fingerprint}</code>. The claim ID never changes; the decision is stored against this fingerprint.</p>
      </section>
    </div>
  </aside>;
}
function requiresNote(item: Item) { return (isClaim(item) && item.interpretation_v2 === "inferred") || (!isClaim(item) && item.basis === "inferred"); }

// ------------------------------------------------------------------ ledger

function LedgerView({ doc, open, selected, drafts }: { doc: V2Doc; open: (id: string, el?: HTMLElement | null) => void; selected: string; drafts: Record<string, Review> }) {
  const [kind, setKind] = useState("all"); const [field, setField] = useState(""); const [decision, setDecision] = useState(""); const [origin, setOrigin] = useState(""); const [q, setQ] = useState("");
  const byId = new Map(doc.claims.map((c) => [c.claim_id, c]));
  const rows: Item[] = [...(kind !== "links" ? doc.claims : []), ...(kind !== "claims" ? doc.relationships : [])].filter((x) =>
    (!field || (isClaim(x) ? x.field === field : x.relation === field)) && (!decision || (decision === "stale" ? isStale(x) : x.review_decision === decision)) &&
    (!origin || (isClaim(x) && (origin === "legacy-issue" ? x.origin === "v1-extraction" && !/^supported$/.test(x.legacy_assessment?.verdict || "") : x.origin === origin))) &&
    (!q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase())));
  const fields = [...new Set(doc.claims.map((c) => c.field))];
  return <div className="v2Ledger">
    <div className="v2Filters" role="search">
      <label>Show<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">Claims and links</option><option value="claims">Claims</option><option value="links">Links</option></select></label>
      <label>Field / relation<select value={field} onChange={(e) => setField(e.target.value)}><option value="">All</option>{fields.map((f) => <option key={f} value={f}>{FIELD_LABELS[f as keyof typeof FIELD_LABELS] || f}</option>)}{Object.entries(RELATION_LABELS).map(([k, v]) => <option key={k} value={k}>link: {v}</option>)}</select></label>
      <label>Decision<select value={decision} onChange={(e) => setDecision(e.target.value)}><option value="">All</option>{DECISIONS.map((x) => <option key={x}>{x}</option>)}<option value="stale">stale</option></select></label>
      <label>Origin<select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="">All</option><option value="v1-extraction">v1 extraction</option><option value="legacy-issue">v1 with a problem</option><option value="prototype-curation">prototype curation</option></select></label>
      <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="value, quote, ID" /></label>
      <span className="v2Muted">{rows.length} shown</span>
    </div>
    <div className="v2TableScroll"><table className="v2LedgerTable">
      <thead><tr><th scope="col">Item</th><th scope="col">Value / link</th><th scope="col">State · interpretation · scope</th><th scope="col">Primary evidence</th><th scope="col">v1 assessment</th><th scope="col">Review</th></tr></thead>
      <tbody>{rows.map((x) => { const p = x.evidence.find((a) => a.role === "primary") || x.evidence[0]; return <tr key={idOf(x)} className={cls(selected === idOf(x) && "selected")}>
        <td><button className="v2TextBtn" onClick={(e) => open(idOf(x), e.currentTarget)}>{isClaim(x) ? FIELD_LABELS[x.field as keyof typeof FIELD_LABELS] || x.field : "Link"}</button><code>{idOf(x)}</code></td>
        <td>{isClaim(x) ? effectiveValue(x) : <>{effectiveValue(byId.get(x.from_claim_id)!)} <em>{RELATION_LABELS[x.relation as keyof typeof RELATION_LABELS]}</em> {effectiveValue(byId.get(x.to_claim_id)!)}</>}</td>
        <td>{isClaim(x) ? <><StateBadge c={x} /><Interp v={x.interpretation_v2} />{x.subject_scope && <span className="v2Scope">{x.subject_scope}</span>}</> : <Basis b={x.basis} />}</td>
        <td className="v2Quote">{p ? <>“{p.exact_quote.length > 140 ? p.exact_quote.slice(0, 140) + "…" : p.exact_quote}” <small>p. {p.pages.join("–")}</small></> : <span className="v2Muted">—</span>}</td>
        <td>{isClaim(x) && x.origin === "v1-extraction" ? <small>{x.legacy_assessment?.verdict}</small> : <small className="v2Muted">new</small>}</td>
        <td><Decision item={x} />{drafts[idOf(x)] && <small className="v2Muted"> draft</small>}</td>
      </tr>; })}</tbody>
    </table></div>
  </div>;
}

// ------------------------------------------------------------------ Table 8.3

function Table83Grid({ t }: { t: ReturnType<typeof buildTable83> }) {
  if (!t.rows.length) return <p className="v2Empty">No verified rows. Nothing reaches Table 8.3 until a physiological parameter, its sensor claims, and the links between them are verified.</p>;
  const list = (xs: { label: string; clearances: number; families: number }[]) => xs.length ? xs.map((x) => `${x.label} (n=${x.clearances})`).join("; ") : "—";
  return <div className="v2TableScroll"><table className="v2T83">
    <thead><tr><th scope="col">Physiological parameter</th><th scope="col">Sensor type</th><th scope="col">No. clearances / families</th><th scope="col">Sensor location(s)</th><th scope="col">Raw/acquired signal</th><th scope="col">Direct / derived</th><th scope="col">Derived/reported features</th><th scope="col">Explicit exclusions</th></tr></thead>
    <tbody>{t.rows.map((r) => r.sensors.map((s, i) => <tr key={r.parameter + s.sensor_type}>
      {i === 0 && <th scope="row" rowSpan={r.sensors.length}>{r.parameter}<small>{r.clearances} clearance(s) · {r.families} famil{r.families === 1 ? "y" : "ies"}</small></th>}
      <td>{s.sensor_type}</td><td>{s.clearances} / {s.families}</td><td>{list(s.locations)}</td><td>{list(s.raw_signals)}</td><td>{list(s.derivation)}</td><td>{list(s.features)}</td><td>{list(s.exclusions)}</td>
    </tr>))}</tbody></table></div>;
}

function Table83View({ canonical, doc, draftCount }: { canonical: V2Doc; doc: V2Doc; draftCount: number }) {
  const committed = useMemo(() => buildTable83([canonical]), [canonical]);
  const preview = useMemo(() => buildTable83([doc]), [doc]);
  return <div className="v2T83View">
    <div className="v2Intro"><h2>Verified Table 8.3 contribution</h2>
      <p>One row per physiological parameter × sensor type (team draft for Table 8.3). A value appears only if its claim is verified, its review is not stale, and every link between it and the parameter is verified. A verified <em>Not stated</em> counts as “Not specified”. Pending, rejected, clarification-needed, and unreadable items never count. Clearance and device-family counts are shown separately.</p></div>
    <h3>From the committed review packet</h3>
    <Table83Grid t={committed} />
    <h3>Preview including this browser’s {draftCount} draft(s) — not authoritative</h3>
    <Table83Grid t={preview} />
    <details><summary>Chains excluded from the preview ({preview.excluded_chains.length})</summary><ul>{preview.excluded_chains.map((e) => <li key={e.chain_id}>{e.chain_id}: {e.reason}</li>)}</ul></details>
  </div>;
}

// ------------------------------------------------------------------ raw

function RawView({ doc }: { doc: V2Doc }) {
  return <div className="v2Raw">
    <div className="v2Intro"><h2>Immutable raw extraction</h2><p>The v1 page text and v1 blocks are kept exactly as extracted. The reconstructed view is derived from the PDF and never overwrites these. Page furniture removed from the reading view is listed here.</p></div>
    <table className="v2LedgerTable"><thead><tr><th scope="col">PDF page</th><th scope="col">Printed label</th><th scope="col">Text layer</th><th scope="col">Tables</th><th scope="col">Page furniture (suppressed in reading view)</th></tr></thead>
      <tbody>{doc.pages.map((p) => <tr key={p.page}><td>{p.page} ({p.orientation})</td><td>{p.page_label || "—"}</td><td>{p.text_layer}{p.ocr ? ` · ${p.ocr.engine}, ${p.ocr.words} words, mean ${p.ocr.mean_conf}%` : ""}</td><td>{p.tables_detected}</td>
        <td>{doc.artifacts.filter((a) => a.page === p.page).map((a) => `${a.role}${a.text ? `: “${a.text}”` : ""}`).join(" · ")}</td></tr>)}</tbody></table>
    {doc.legacy.pages.map((p) => <details key={p.page}><summary>v1 page {p.page} · {p.extraction_method} · {p.text.length} characters · blocks {doc.legacy.blocks.filter((b) => b.page === p.page).map((b) => b.block_id.split("-").at(-1)).join(", ")}</summary><pre className="v2Pre">{p.text}</pre></details>)}
  </div>;
}

