# Claude Code project instructions

Read `README.md` and `docs/SECURITY_AND_DEPLOYMENT.md` before changing code.

## Mission

Rework the FDA 510(k) clearance experience into a publication-grade evidence
review system. The current site is a functional prototype and data snapshot,
not an accepted design. The user's main dissatisfaction is that the rendered
510(k) summary and its evidence rows do not capture the document's structure or
the scientific measurement chain with enough fidelity.

## First priority

Begin with one representative, evidence-rich clearance and redesign its page.
Do not start by applying cosmetic changes to all 266 pages.

The redesigned page should let a reviewer:

1. understand the device and its measurement architecture;
2. read a high-fidelity, sectioned reconstruction of the FDA document;
3. compare the relevant PDF page beside the transcription;
4. inspect a structured chain of sensor → location → raw signal → physiological
   parameter → direct/derived status → derived feature → reported output;
5. see the exact field-specific source passage for every proposed fact;
6. distinguish explicit text, careful normalization, and unsupported inference;
7. adjudicate without losing stable claim IDs or prior review state.

## Scientific constraints

- The FDA PDF is the ultimate regulatory source.
- Never use general device knowledge to fill a clearance-level field.
- Keep sensor, location, raw signal, physiological parameter, derived feature,
  and diagnostic output conceptually and structurally separate.
- A quote must support the exact proposed field, not merely contain related
  words.
- Do not infer PPG from SpO2, a pressure transducer from “airflow,” calibrated
  effort from a belt, AHI from event detection, location from a sensor name, or
  a reported output from a recorded waveform.
- Preserve `Not stated`, `Not applicable`, `Unreadable`, and blank as distinct
  states.
- Do not let pending, unsupported, rejected, or unreadable claims contribute to
  Table 8.3.
- Keep K-number counts and device-family counts separate.
- Keep later manufacturer-labeling evidence in a distinct source layer.

## Engineering constraints

- Preserve direct `/510k/{K_NUMBER}/` URLs.
- Preserve source metadata, page numbers, block IDs, claim IDs, exact excerpts,
  review decisions, and JSON/Excel round trips.
- Treat `public/evidence_data/` as generated data. Do not hand-edit hundreds of
  document JSON files.
- Do not rewrite or normalize exact source excerpts.
- Add migration logic if a new schema is introduced.
- Keep GitHub Pages working at the `/evidence-explorer/` base path and ChatGPT
  Sites working at `/`.
- Run `npm test` and `npm run build:pages` before committing.
- Never commit credentials, API keys, service-account JSON, temporary Sites
  tokens, or local `.env` files.

## Design direction

Prefer a document-first review workspace over a generic dashboard table.
Possible structure:

- compact clearance identity and provenance header;
- synchronized PDF/transcription reading pane;
- real document outline with section navigation;
- device measurement-chain summary organized by sensor system;
- claim drawer or inspector tied to highlighted evidence;
- clear badges for evidence strength and review status;
- missing/unreadable states shown explicitly;
- reviewer progress and unresolved issues, without visual clutter.

Tables must be reconstructed as tables when their structure can be established.
Do not display every extracted line as an undifferentiated paragraph. Repeated
headers, footers, page numbers, and OCR debris should be represented separately
or suppressed in the display while immutable raw extraction remains retained.

## Required work sequence

1. Audit the existing schema and one representative JSON document.
2. State which aspects of the source can and cannot be rendered faithfully with
   current data.
3. Propose a revised block/document schema if necessary.
4. Build and test one clearance-page prototype.
5. Validate it against the original FDA PDF and the researcher's workflow.
6. Only then generalize to the corpus.
7. Preserve or migrate all review records.
8. Rebuild verified-only aggregation and drill-down tests.

Do not claim publication readiness merely because the interface builds. The
20-document OCR/layout pilot and human semantic review must pass first.

