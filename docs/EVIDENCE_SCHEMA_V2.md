# Evidence schema v2: audit, design, and migration

Status: **prototype, one clearance (K143272, ApneaLink Air)**. Nothing in this
document authorizes a corpus-wide rewrite. The v1 snapshot in
`public/evidence_data/` remains the canonical published record until the
prototype has been reviewed.

## 1. Why K143272

K143272 (ResMed ApneaLink Air, MNR, 2015-04-30, 15 pages) was chosen because it
contains most of the failure modes the corpus must handle:

| Property | Where | Why it matters |
| --- | --- | --- |
| FDA SE letter, IFU form, and applicant summary in one PDF | pp. 1–2, 3, 4–15 | A document has *parts*; each part has its own section tree |
| Image-only Indications-for-Use form (Form FDA 3881) | p. 3 | Text layer holds only the running header/footer; the legacy pipeline labelled the page `native` and never transcribed the IFU statement |
| Nine-page, five-column comparison table | pp. 6–14 | Two **predicate** columns (Nox T3 K082113, ApneaLink Pro K131932), one **subject** column, one comment column; merged cells; rows continue across page breaks |
| Four sensor systems plus an undocumented one | pp. 5, 8–10 | Nasal cannula/pressure sensor, pneumatic effort sensor, finger oximeter, actigraphy; snoring is recorded but no sensor is stated |
| Recorded-but-not-reported data | pp. 5, 8, 11 | Body-position data is stored as EDF+ and is explicitly *excluded* from the report |
| Pressure-to-flow transformation stated explicitly | p. 10 | Allows a supported "derived" status without inference |

## 2. Audit of the v1 schema

### 2.1 What v1 stores

```text
document  : identity + provenance (K, product code, SHA-256, URLs, pages, family)
pages[]   : {page, extraction_method, text, character_count}
blocks[]  : {block_id, page, ordinal, type ∈ {paragraph, heading}, section, text,
             extraction_method, character_count}
claims[]  : {claim_id, k_number, family_*, field, source_value, normalized_value,
             page, section, block_id, supporting_excerpt, surrounding_context,
             evidence_text_match, interpretation_status, model_confidence,
             source_layer, source_sha256, review_decision, reviewed_value,
             reviewer_date, reviewer_notes}
```

### 2.2 What v1 cannot represent (measured on K143272)

| Gap | Evidence from K143272 | Consequence |
| --- | --- | --- |
| No geometry | blocks have no bbox, no line structure | PDF cannot be highlighted; page sync is impossible beyond "page N" |
| No document parts or section tree | `section` is a flat string; only 3 distinct values (`Document`, `510(k) Summary – ApneaLink Air`, `5 510(k) Summary – ApneaLink Air`) | No outline; headings such as *Device Description*, *Intended Use*, *Technology*, *Testing summary* are buried in paragraphs |
| No page artifacts | running header, `Page N of 12`, ResMed logo, letter continuation header are inline block text (e.g. `K143272-P008-B001`, `-B002`) | Reading order is interrupted on every page |
| No tables | the comparison table is emitted as paragraph blocks whose text **interleaves all five columns** line by line (e.g. `K143272-P011-B007`) | Column provenance is lost: a quote cannot be attributed to the subject or a predicate device |
| No image-only page flag | p. 3 is `native` with 99 characters | The formal IFU statement is absent from the transcript |
| One excerpt per claim, field-agnostic | 18 of 37 claims share one excerpt per sensor system across the sensor, location, raw-signal, parameter and derivation fields (4 systems) | `evidence_text_match: pass` is reported for excerpts that do not mention the value |
| No subject/predicate scope | `CLM-25cea7da6112` proposes "RIP technology" from the **Nox T3** column; subject uses "a pneumatic principle"; `CLM-964ea01d51e5` (AHI) quotes the Noxturnal index list | Predicate facts leak into subject-device claims |
| No relationships | sensors, signals, parameters, outputs are independent rows | "Which signal does this sensor produce?" is not answerable or reviewable |
| No explicit missing-value claims | missing values are simply absent | `Not stated` (e.g. oximeter raw signal) is indistinguishable from "not yet extracted" |
| No negation | `CLM-030e4da72b91` lists "Body position data" as a reported feature | The source says the data are *not* part of the report |
| Compound values | `CLM-f706d25f6cda` "Blood oxygen saturation and pulse" | Not atomic; cannot be verified per parameter |
| No review staleness | review fields are free-standing | If evidence changes after review, the decision silently carries over |

### 2.3 Legacy claim audit for K143272 (37 claims)

Assessments are **curator proposals** (prototype curation draft), not review
decisions. Every legacy `review_decision` is left untouched (`pending`).

| Verdict | Count | Examples |
| --- | ---: | --- |
| Supported; v1 evidence adequate | 16 | `CLM-bf8541d0dc67` finger; 11 index/feature items quoted from the merged ApneaLink Pro/Air cell |
| Supported only after re-anchoring | 12 | 6 quoted a **predicate** column (`CLM-964ea01d51e5` AHI, `CLM-5db33eba2fd1` actigraphy); others quoted a block that never mentions the value (`CLM-9feb9ae5aa69` location cites the Sensor Technology cell) |
| Supported with limitation | 1 | `CLM-0924252480a1` effort "measured": calibration not stated |
| Inferred, not stated | 1 | `CLM-32b036c02477` actigraphy sensor "inside recorder" |
| Misclassified field | 3 | `CLM-b02ad0500a1b` "Oxygen saturation and pulse rate" as raw signal |
| Not atomic | 1 | `CLM-f706d25f6cda` |
| Contradicted / unsupported | 3 | `CLM-25cea7da6112` RIP; `CLM-030e4da72b91` body position as report feature; `CLM-39b492a99694` "evaluation" |

Recommended actions: 28 verify, 1 edit-and-verify, 1 needs clarification, 7 reject. 32 new claims
(10 of them explicit `Not stated`) and 68 relationships (42 explicit, 11 output-name, 2 inferred,
13 recorded as *not stated*) were proposed. 173 evidence anchors, all literal.

The exact per-claim list is generated into the v2 document
(`legacy_assessment` on each claim) and shown in the prototype's claim ledger.

## 3. What the source can and cannot support with current data

Can be rendered faithfully for K143272 (born-digital text layer + vector ruling):

- page geometry, reading order, headings (font weight/size), lists, key–value
  header table (whitespace alignment), and the comparison table (vector cell
  rectangles);
- merged cells and cross-page row continuation;
- column scope for every table cell;
- superscripts (`30th`, `™`) as separate glyph runs.

Cannot be rendered faithfully without better OCR/layout:

- the p. 3 IFU form beyond local Tesseract OCR (word confidences retained;
  checkbox glyphs read at 42–44 % confidence);
- scanned documents in the corpus (324 OCR pages): no word geometry or table
  structure is available from the current local OCR derivative;
- any table drawn without ruling lines except simple two-column key–value lists.

## 4. v2 schema

A v2 record is **additive**: every v1 structure is preserved verbatim under
`legacy`, and every v1 claim keeps its ID and all v1 fields.

```text
schema_version: "2.0-prototype"
document                (v1 document object, unchanged)
build                   {builder, builder_version, built_at, inputs{pdf_sha256, legacy_json_sha256},
                         text_layers[], structure_methods[]}
legacy                  {pages[] (v1, verbatim), blocks[] (v1, verbatim)}   ← immutable raw extraction
pages[]                 {page, width, height, orientation, page_label, part_id,
                         text_layer: native|image-only|mixed, image_coverage,
                         render: "pages/K…/p-NN.png", ocr?: {engine, version, dpi, mean_conf, words}}
parts[]                 {part_id, title, title_source: source|inferred, pages[]}
sections[]              {section_id, part_id, parent_id, level, title, title_source,
                         page_start, page_end, block_ids[]}
artifacts[]             {artifact_id, page, role: running_header|running_footer|page_number|
                         logo|letter_continuation|image_region, text, bbox}      ← suppressed in reading view
blocks[]                {block_id, page, pages[], section_id, order, type: heading|paragraph|
                         list_item|key_value|signature|letterhead|table_ref|ocr_text,
                         text, lines[{text, bbox, sup?}], bbox, text_layer, level?,
                         lead_in?, legacy_block_ids[], ocr_conf?}
tables[]                {table_id, section_id, pages[], title, structure_method, structure_confidence,
                         columns[{col_id, label, role: characteristic|predicate|subject|comment,
                                  device, k_number}],
                         rows[{row_id, label, pages[], cells[{cell_id, col_ids[], scope, text,
                               segments[{page, bbox, text, char_start, char_end}]}]}]}
claims[]                v1 fields + {
                         value_state: stated|Not stated|Not applicable|Unreadable|"" (blank = not assessed),
                         category (controlled Table 8.3 label), aggregate (false = component/module, never counted),
                         polarity: affirmed|negated,
                         interpretation_status (v2 vocabulary: explicit|normalized|inferred|
                           not stated|unreadable|contradicted; v1 values kept on v1 claims),
                         interpretation_note, subject_scope: subject|shared|comment|predicate,
                         evidence[anchor], evidence_fingerprint,
                         origin: v1-extraction|prototype-curation, curation_ref,
                         legacy_assessment?{verdict, recommended_action, note, superseded_by[]},
                         reviewed_evidence_fingerprint, reviewed_category, reviewer }
anchor                  {anchor_id, role: primary|context|limiting, target{kind: block|table_cell,
                         id, table_id?, row_id?, col_ids?}, page, pages[], section_id,
                         exact_quote, char_start, char_end, bboxes[{page,x0,top,x1,bottom}],
                         text_layer, scope, ocr_min_conf?}
chains[]                {chain_id, kind: measurement|report, label, slots{<7 chain fields> + Section 8.2
                         fields (signal_access, sampling_resolution, continuity, synchronization,
                         calibration, validation_comparator): {state, claim_ids[]}}, caveats[]}
relationships[]         {relationship_id, chain_id, from_claim_id, to_claim_id, relation,
                         relation: component_of|located_at|acquires|represents|measures|derivation|
                           derived_feature_of|reported_as|generated_by,
                         basis: explicit|same-cell|output-name|inferred|not-stated,
                         evidence[anchor], note, review fields, evidence_fingerprint}
```

### 4.1 Invariants (enforced by tests)

1. `anchor.exact_quote === targetText.slice(char_start, char_end)` for every
   anchor; the builder refuses to emit an anchor that does not resolve to
   exactly one location.
2. Every v1 claim ID for the clearance exists in v2 with byte-identical v1
   fields and review fields.
3. New claim and relationship IDs are deterministic
   (`sha256(k | field | curation_ref)`), never collide with any corpus v1 ID,
   and are never reused.
4. A claim whose primary evidence comes only from a `predicate` column cannot
   be proposed for the subject device.
5. `value_state ≠ stated` claims carry no value in aggregation; `negated`
   claims aggregate as exclusions, never as outputs.
6. Table 8.3 (parameter × sensor type, per the team discussion draft) uses only `verified` / `edited and verified` claims whose
   `reviewed_evidence_fingerprint` equals the current `evidence_fingerprint`,
   connected to a verified physiological parameter through **verified**
   relationships within the same chain. Clearance counts and family counts are
   computed separately.
7. Verifying an `inferred` claim or relationship requires reviewer notes.

### 4.2 Review states

Unchanged vocabulary: `pending`, `verified`, `edited and verified`,
`rejected`, `needs clarification`. Reviewers act on claims **and**
relationships. Browser drafts are local only; the JSON packet
(`evidence_data/v2/review/K143272_review_v2.json`) and workbook
(`…_review_v2.xlsx`) are the portable records.

## 5. Migration design

```text
v1 document JSON ─┐
v1 review packet ─┼─► pipeline/build_document_v2.py ─► v2 document JSON
FDA PDF (private) ┤          │                            │
curation proposals┤          │                            ├─► scripts/v2/build-review-artifacts.mjs
v2 review packet ─┘          │                            │      → review JSON, review XLSX, Table 8.3
 (if it exists)              └─ refuses unresolved quotes └─► scripts/v2/import-review.mjs (JSON/XLSX → packet)
```

Precedence for review fields on rebuild: v2 packet > v1 packet > defaults.
No review decision is ever created or changed by the builder.

Staleness: every claim/relationship has an `evidence_fingerprint` computed from
content (value, state, polarity, quotes, pages, scopes) — not from IDs — so
re-segmentation does not invalidate reviews, but a changed quote or value does.
A review whose stored fingerprint differs is shown as **stale** and excluded
from Table 8.3 until re-confirmed.

Corpus generalization (not started): run the structural builder per clearance;
documents without vector tables or with OCR-only pages get structure
`confidence: low` and remain in the pilot gate. Curation proposals would be
generated by a model and must pass the same literal-anchor resolver.

## 6. Table 8.3 semantics (from the team discussion draft)

- Row = physiological parameter category × sensor type category; underlying
  unit = clearance × chain × parameter.
- Columns: clearances and families (separately), sensor locations, raw/acquired
  signals, direct/derived status, derived/reported features, explicit
  exclusions (negated outputs such as "not part of the report").
- A verified `Not stated` appears as "Not specified (n)". Unverified gaps do
  not appear at all.
- A verified parameter whose sensor link is not verified appears under
  "(sensor link not verified)", so parameter prevalence is complete while
  sensor sub-rows never contain unverified pairings.
- Outputs whose input link is `not-stated` (AHI, RI, AI, HI, CSB, ODI in
  K143272) are not attached to any parameter. Whether a reviewer may assert
  such a link from domain knowledge is a **team decision not yet made**; the
  prototype does not allow it.
- Section 8.2 fields (raw waveform retained/accessible, sampling, continuity,
  synchronization, calibration, validation) are recorded per chain for Table 8.4
  and do not change Table 8.3 counts.
