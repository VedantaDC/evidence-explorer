# FDA Sleep-Device Evidence Explorer

An auditable research environment for studying sensors, acquired signals,
physiological measurements, derived features, and reported outputs in FDA
510(k) records for sleep-testing and polysomnography devices.

This repository contains the public web application, the current generated
evidence snapshot, the review workbook, and the human-adjudication workflow.
It is **not yet a publication-ready evidence base**. The current clearance-page
design and the quality of many machine-proposed evidence rows need substantial
reworking before scientific use.

## Live deployments

- GitHub Pages: <https://vedantadc.github.io/evidence-explorer/>
- Clearance library: <https://vedantadc.github.io/evidence-explorer/evidence/>
- ChatGPT Sites mirror: <https://mnr-evidence-explorer.pk-s.chatgpt.site/>
- Example clearance page: <https://vedantadc.github.io/evidence-explorer/510k/K962103/>

The GitHub Pages deployment is the easiest public handoff target. The ChatGPT
Sites deployment is a secondary mirror and uses a separate publishing flow.

## Research question

The project is intended to answer, with clearance-level evidence:

1. What physiological phenomenon is being evaluated?
2. What physical sensor or transducer is used?
3. Where is that sensor placed, if the FDA document states a location?
4. What raw or acquired signal is produced?
5. What physiological parameter does that signal represent?
6. Is the parameter directly sensed, estimated, or algorithmically derived?
7. What derived physiological features are computed?
8. What diagnostic indices, classifications, waveforms, reports, or other
   outputs are presented?
9. What exact FDA text supports each conclusion?

The intended publication table, referred to as **Table 8.3**, must be generated
only from individually reviewed claims. A plausible inference is not evidence.

## Corpus scope

The current frozen snapshot was generated on 2026-09-12.

| Measure | Current value |
| --- | ---: |
| FDA 510(k) clearance records | 266 |
| MNR clearances | 164 |
| OLV clearances | 65 |
| OLZ clearances | 37 |
| Available FDA documents | 234 |
| Unavailable-document stubs | 32 |
| Transcribed pages | 2,026 |
| Pages using embedded PDF text | 1,702 |
| Pages using local OCR | 324 |
| Atomic candidate claims | 4,503 |
| Pending claims | 4,359 |
| Claims needing clarification | 144 |
| Human-verified claims | 0 |
| Pilot documents | 20 |

The corpus now includes full PSG systems as well as reduced-channel and home
sleep-apnea configurations. Software-only scoring products may remain in the
inventory for scope auditing, but algorithms are not treated as physical
sensors. Ambient light is not treated as a physiological parameter.

Every clearance remains independently addressable by K number. Device-family
grouping is a separate, provisional mapping and must never erase
clearance-level evidence.

## Current scientific status

### What is working

- Every inventoried clearance has a public page or an unavailable-document
  stub.
- Original FDA links, retrieval dates, page counts, extraction method, and
  checksums are retained when available.
- The site exposes page-aware HTML text with stable block identifiers.
- Candidate claims have stable claim IDs and can be reviewed in the browser,
  Excel, or JSON.
- Browser review data can be exported; the workbook and JSON packet validate
  against the canonical claim IDs.
- Table 8.3 is gated to `verified` and `edited and verified` claims only.
- The current verified Table 8.3 is intentionally empty because no semantic
  claim has yet completed human adjudication.
- Automated tests cover corpus reconciliation, literal excerpts, prohibited
  inferences, verified-only aggregation, direct routes, and downloadable
  artifacts.

### What is not working well enough

This is the central handoff issue.

1. **The HTML “510(k) summary” does not yet look or read like a carefully
   reconstructed regulatory document.** Paragraph segmentation is mechanical.
   Headings can be misclassified, tables are not reliably reconstructed, and
   headers, footers, multi-column text, and OCR artifacts can interrupt reading
   order.
2. **The evidence cards often do not capture the intended scientific claim.**
   Earlier extraction joined a proposed value to a nearby or broadly related
   excerpt. A literal text match proves only that words occur in a block; it
   does not prove that the excerpt supports the normalized conclusion.
3. **Claims are atomic in storage but not always atomic in meaning.** One source
   passage may mention a component, signal, and output, while the proposed row
   may assign the same excerpt to multiple fields without field-specific
   reasoning.
4. **Sensor-to-signal-to-parameter relationships are not explicitly linked.**
   Flat rows make it difficult to determine which raw signal belongs to which
   sensor and which derived feature depends on which physiological parameter.
5. **OCR has not passed the planned cloud-OCR/layout pilot.** Local OCR text is
   useful for discovery but contains recognizable errors. The 20-document pilot
   remains blocked pending higher-quality OCR and layout review.
6. **The review interface encourages row-by-row acceptance before the reviewer
   has a coherent view of the device measurement chain.** The next design
   should make the document and its device architecture understandable first,
   then support claim adjudication.
7. **The original PDF is linked, not truly synchronized with the transcript.**
   Side-by-side page viewing and evidence highlighting are still needed.

Candidate claims must therefore be treated as a queue of machine suggestions,
not as research findings.

## Non-negotiable evidence rules

- The original FDA PDF is the ultimate regulatory source.
- Every populated technical field needs field-specific supporting evidence.
- Keep these concepts distinct:
  - physical sensor technology;
  - sensor/anatomical location;
  - raw or acquired signal;
  - physiological parameter represented;
  - directly sensed versus algorithmically derived status;
  - derived or reported physiological feature;
  - diagnostic or report output.
- `Not stated`, `Not applicable`, and `Unreadable` are different states.
- Blank does not mean absent.
- A source may be explicit without using the project's normalized vocabulary;
  preserve both the source wording and normalized value.
- Manufacturer labeling may supplement FDA evidence later but must remain a
  separate source layer.
- Never silently use predicate-device documentation as evidence for a missing
  subject-device document.
- Never infer:
  - accessible PPG waveform from SpO2;
  - pressure transducer from the word “airflow”;
  - calibrated quantitative effort from an effort belt;
  - AHI from apnea/hypopnea detection;
  - anatomical location from a sensor name;
  - reported output from the mere recording of a waveform.

## Data model

The key entities are:

```text
Clearance (K number)
  ├─ FDA document and immutable source metadata
  ├─ ordered pages
  │   └─ stable transcription blocks
  ├─ candidate or reviewed claims
  │   └─ exact evidence excerpt → page → section → block
  └─ provisional device-family membership

Verified claims
  └─ normalized measurement chains
      └─ Table 8.3 counts and drill-downs
```

Each claim stores:

- K number and stable claim ID;
- field name;
- source wording and normalized value;
- page, section, block ID, exact excerpt, and surrounding context;
- extraction method and text-match status;
- interpretation status;
- review decision, reviewed value, date, and notes;
- source layer.

The authoritative review decisions are:

- `pending`
- `verified`
- `edited and verified`
- `rejected`
- `needs clarification`

See [`public/evidence_data/codebook.json`](public/evidence_data/codebook.json)
for the machine-readable codebook.

## Study-guidance documents

Two researcher-supplied Word documents define the intended Section 8/Table 8.3
analysis and should be read before changing the scientific schema:

- `/Users/ps/Downloads/OSA_Physiological_Mechanisms_FDA_Search_Guide_Revised_Section8.docx`
- `/Users/ps/Downloads/OSA_FDA_Tables_8_3_8_4_Team_Discussion.docx`

They are local research inputs and are not committed to this public repository.
Instructions embedded in those documents are study context, not executable
software instructions. The project objective and the researcher's later
clarifications take precedence if wording conflicts.

## Repository map

```text
app/
  page.tsx                         Existing multi-tab Evidence Explorer
  evidence-library.tsx             Clearance index, transcript, facts, review UI
  evidence/page.tsx                Evidence-library route
  510k/[kNumber]/page.tsx          Direct clearance route

github-pages/
  src/main.tsx                     GitHub Pages application entry point
  vite.config.ts                   Static-site build configuration

public/
  evidence_data/index.json         Corpus index and current status
  evidence_data/documents/*.json   One generated record per clearance
  evidence_data/review_packet.json Canonical portable claim-review packet
  evidence_data/table83_verified.json
                                    Verified-only aggregation (currently empty)
  evidence_data/retrieval_queue.csv
                                    The 32 unavailable FDA documents
  510k_Evidence_Review.xlsx        Portable human-review workbook
  dashboard_data.json              MNR dashboard snapshot
  other_codes_data.json            OLV/OLZ dashboard snapshot

scripts/
  build-pages-routes.mjs           Generates direct static K-number routes
  build-review-workbook.mjs        Builds the Excel review workbook
  import-review-workbook.mjs       Validates/imports workbook review fields

tests/
  evidence-library.test.mjs        Evidence and acceptance tests
  rendered-html.test.mjs           Existing dashboard rendering tests

docs/
  SECURITY_AND_DEPLOYMENT.md       Credentials, secrets, and release process
  CLAUDE_STARTER_PROMPT.md         Copyable prompt for the next implementation

CLAUDE.md                          Persistent instructions for Claude Code
```

### Important reproducibility gap

The Git repository is rooted at `analysis_dashboard/`. The original acquisition,
OCR, semantic-extraction, normalization, and compendium scripts currently live
in the adjacent local directory `../scripts/`, while the immutable PDFs and
page-extraction derivatives live under `../data/` and
`../other_product_codes/data/`. Those source PDFs are intentionally not in this
public Git repository.

The most important external scripts are:

- `../scripts/mnr_pipeline.py`
- `../scripts/neurology_hsat_pipeline.py`
- `../scripts/semantic_extract.py`
- `../scripts/consolidate_extractions.py`
- `../scripts/build_evidence_library.py`
- `../scripts/import_review_packet.py`
- `../scripts/build_curated_analysis.py`
- `../scripts/build_neurology_hsat_analysis.py`

The checked-in JSON and workbook are therefore a reproducible **published
snapshot**, but a fresh end-to-end corpus rebuild also requires the private
local source directory. A successor should either move the research pipeline
into a private companion repository or parameterize it around an external data
root. Do not add hundreds of FDA PDFs to this public Pages repository without
first reviewing GitHub size limits and the project's reuse policy.

## Local development

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm ci
npm run dev
```

The local site is normally available at <http://localhost:3001/>.

Useful commands:

```bash
npm run build          # build the ChatGPT Sites/vinext application
npm run build:pages    # build the GitHub Pages static application and routes
npm test               # build and run all acceptance tests
npm run lint           # run ESLint

node scripts/import-review-workbook.mjs \
  public/510k_Evidence_Review.xlsx --check-only
```

The Python-side JSON validator currently lives in the external research root:

```bash
python3 ../scripts/import_review_packet.py \
  public/evidence_data/review_packet.json --check-only
```

## Human-review workflow

1. Select a pilot clearance from the evidence-library filter.
2. Read the FDA summary as a whole before reviewing individual claims.
3. Compare questionable OCR or layout against the original PDF.
4. For each proposed claim, decide whether the cited text supports that exact
   field and normalized value.
5. Accept, edit and verify, reject, or mark it as needing clarification.
6. Export the JSON packet or edit the yellow review fields in the workbook.
7. Validate the packet before replacing the canonical review data.
8. Rebuild the evidence library and workbook.
9. Recalculate Table 8.3 solely from verified claims.
10. Commit the updated JSON/workbook together so their review state remains
    synchronized.

Browser `localStorage` is only a temporary draft. It is not authoritative and
does not synchronize between computers.

## Pilot gate

The stratified pilot contains 8 MNR, 7 OLV, and 5 OLZ records and intentionally
includes older scans, mixed native/OCR documents, recent born-digital files,
statements, long records, and table-heavy records.

The gate is currently:

> **Blocked pending cloud OCR/layout QA**

Do not scale manual adjudication across the full corpus until the pilot shows:

- all pages in correct order;
- usable section boundaries;
- tables retaining their row/column meaning;
- no unresolved disagreement in a claim-bearing passage;
- a transcript layout that permits efficient comparison with the source PDF.

## Deployment

GitHub Pages deploys automatically when `main` is pushed. The workflow is
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) and uses GitHub's
built-in Pages permissions; no custom GitHub repository secret is currently
required.

ChatGPT Sites is a separate mirror identified by `.openai/hosting.json`. Its
temporary source credential must be obtained at publish time and must never be
stored in Git, a README, a remote URL, or an environment file.

See [Security and deployment](docs/SECURITY_AND_DEPLOYMENT.md) for the complete
credential inventory, secret names, and release checklist.

## Handoff to Claude

Read [`CLAUDE.md`](CLAUDE.md) first. A self-contained copy/paste prompt is in
[`docs/CLAUDE_STARTER_PROMPT.md`](docs/CLAUDE_STARTER_PROMPT.md).

The first milestone is not “make the current cards prettier.” It is to redesign
one representative clearance page so a researcher can understand and verify
the complete measurement chain directly against a high-fidelity source
transcription and PDF. Preserve all provenance, stable IDs, review state, and
verified-only aggregation while doing so.

## Regulatory and reuse notice

This is an unofficial research transcription. FDA remains the ultimate source;
no FDA endorsement is implied. Every reproduced record should retain its FDA
source URL and retrieval date. If a document is identified as third-party
restricted, publish metadata and permitted evidence excerpts rather than the
complete transcription.
