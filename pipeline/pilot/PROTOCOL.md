# AI extraction protocol — Table 8.3 pilot (v2)

You are extracting **FDA-documented device facts** for one 510(k) clearance, to
build a cumulative measurement inventory (Table 8.3) of OSA diagnostic devices:
physiological parameter × sensor type, with sensor location, raw/acquired
signal, direct/derived status, and derived/reported features.

The research question is which physiological manifestations FDA-authorized
OSA diagnostic devices actually measure, with which sensors, at which body
locations. Separately, it asks what the documents do **not** establish (for
example whether raw waveforms are retained). Precision about what the
document says matters more than completeness. A wrong fact is worse than a
recorded gap.

## Inputs

- `<K>.units.txt`: the reconstructed document. Every quotable unit has an ID.
  Table cells carry a scope:
  - `subject`: the device under review.
  - `predicate`: a comparison device. **Never** use it as evidence for the
    subject device; use it only as `limiting` evidence.
  - `shared`: a merged cell spanning the subject column; it applies to the
    subject.
  - `comment`: applicant commentary. It may describe the subject; mark
    interpretation `normalized`.
  - `unknown`: the column role could not be established. Check the PDF
    header, and say what you found in `note`.
- The original PDF (path given). Look at page images when OCR is flagged, when
  a table's column roles are `unknown`, or when layout is unclear.
- `pipeline/codebook_v2.json`: controlled categories.
- Worked example: `pipeline/curation/K143272.json` (read its `claims`,
  `chains` and `relationships`; ignore `legacy_assessments`).

## Rules (non-negotiable)

1. Use only this clearance's document. Use no general device knowledge, no
   manufacturer labeling, and no predicate device's facts.
2. Every stated claim needs ≥1 `primary` evidence quote that supports **that
   exact field and value**. A related word nearby is not support.
3. Keep sensor, location, raw signal, parameter, derived/direct status, feature
   and output separate. One claim = one atomic value.
4. Never infer:
   - a PPG waveform from SpO2 or pulse;
   - a pressure transducer from "airflow";
   - calibrated or quantitative effort from an effort belt;
   - AHI from apnea/hypopnea detection;
   - an anatomical location from a sensor's name;
   - a reported output from a recorded waveform.
5. **Policy A:** link an output (AHI, REI, ODI, RDI, pAHI, …) to a
   physiological parameter only if the document states which signals it uses.
   Otherwise add a relationship with basis `not-stated`.
6. Record gaps explicitly. If a chain field is not in the document, add a
   claim with `"value_state": "Not stated"`, `"normalized_value": "Not stated"`,
   `"interpretation": "not stated"`, and `absence_terms` (the words you
   searched for). Leave a field out entirely (blank) only if you did not
   assess it.
7. A statement that something is *not* reported gets `"polarity": "negated"`.
8. `category` must come from the codebook. If nothing fits, use
   `NEW: <label>` and explain in `note`.
9. Components and modules (cannula, pod, belt, recorder housing) get
   `"aggregate": false` with `aggregate_note`. The Table 8.3 sensor type
   comes from the sensing element.
10. **Quotes must be copied exactly** from one unit. Whitespace may differ;
    nothing else may. Keep each quote short but sufficient, typically one
    clause or cell sentence.

## What to extract

1. **Eligibility:** one claim with `field: "eligibility"`,
   `normalized_value` "Eligible" or "Not eligible", and the IFU quote.
   A device is eligible if its indications for use state that it
   diagnoses, screens for, evaluates, assesses, or otherwise contributes to
   the diagnosis of OSA or sleep-disordered breathing (Methods).
2. **One measurement chain per physiological parameter** (e.g. airflow,
   effort, SpO2, pulse rate, body position, snoring, PAT, sleep/wake, EEG,
   movement), with slots `sensor_technology`, `sensor_location`,
   `raw_acquired_signal`, `physiological_parameter`, `direct_vs_derived`,
   `derived_reported_feature`, `diagnostic_output`. Add supplementary slots
   when stated or checked: `signal_access` (raw signal retained or accessible:
   Yes/No/Unclear), `sampling_resolution`, `continuity`, `synchronization`,
   `calibration`, `validation_comparator`.
3. **One report chain** (`"kind": "report"`) for the device's outputs and
   indices (AHI/REI/ODI, sleep staging, summaries). Also record
   `processing_approach` (ML/AI vs rule-based) when stated, else `Not stated`.
4. **Relationships** linking the chain (see codebook `relations` and
   `bases`). Every stated link needs evidence, except `not-stated` links.
   Give each relationship a unique `ref` (e.g. `r01`).

## Output JSON (write to the path you are given)

```json
{
 "k_number": "K000000",
 "curator": "<your role label>",
 "curated_on": "2026-09-24",
 "status": "AI extraction, not human-reviewed",
 "scope_note": "Only the K000000 FDA document.",
 "claims": [
  {"ref": "elig", "field": "eligibility", "normalized_value": "Eligible", "source_value": "aid in the diagnosis of sleep disordered breathing",
   "category": "Eligible", "value_state": "stated", "interpretation": "explicit", "polarity": "affirmed", "note": "",
   "aggregate": false, "aggregate_note": "Eligibility gate, not a measurement field.",
   "evidence": [{"unit": "K000000-V2-P005-B006", "quote": "...", "role": "primary", "value": "aid in the diagnosis"}]},
  {"ref": "air.sensor", "field": "sensor_technology", "normalized_value": "...", "source_value": "...", "category": "Nasal pressure transducer",
   "value_state": "stated", "interpretation": "explicit", "polarity": "affirmed", "note": "",
   "evidence": [{"unit": "<unit id>", "quote": "<exact text>", "role": "primary", "value": "<words in the quote naming the value>"}]},
  {"ref": "ox.raw", "field": "raw_acquired_signal", "normalized_value": "Not stated", "source_value": "", "category": "Not specified",
   "value_state": "Not stated", "interpretation": "not stated", "polarity": "affirmed", "note": "...", "absence_terms": ["PPG", "photopleth", "waveform"], "evidence": []}
 ],
 "chains": [{"chain_id": "CHN-K000000-AIRFLOW", "kind": "measurement", "label": "...", "summary": "...",
             "slots": {"sensor_technology": ["air.sensor"], "physiological_parameter": ["air.param"]}, "caveats": ["..."]}],
 "relationships": [{"ref": "r01", "chain": "CHN-K000000-AIRFLOW", "from": "air.sensor", "relation": "acquires", "to": "air.raw", "basis": "explicit",
                    "note": "", "evidence": [{"unit": "<id>", "quote": "<exact>", "role": "primary"}]}]
}
```

Evidence `role` is `primary`, `context`, or `limiting`. Refs must be unique
within the file. A claim may appear in several chains.

## Validate before you finish (mandatory)

Run the validator shown in your task. Fix every error it reports and rerun
until it prints `"valid": true`. Typical errors: a quote not found exactly
(copy it again from the unit text), a quote found twice (lengthen it), a
subject claim resting only on a predicate cell, or a relationship referencing
an unknown ref.
