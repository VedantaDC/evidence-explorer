# Starter prompt for Claude

Copy the prompt below into a new Claude Code session opened at the repository
root.

---

You are taking over an FDA sleep-device evidence research project. Work in the
current repository and begin by reading `README.md`, `CLAUDE.md`,
`docs/SECURITY_AND_DEPLOYMENT.md`, the tests, and the evidence data codebook.
Do not assume the current interface or extraction is correct merely because it
exists.

The project inventories 266 FDA 510(k) clearances across product codes MNR,
OLV, and OLZ. It contains 234 available FDA documents, 32 unavailable-document
stubs, 2,026 transcribed pages, and 4,503 machine-proposed atomic claims. No
semantic claim is human-verified yet, so the verified Table 8.3 is intentionally
empty.

The current implementation is unsatisfactory in two related ways:

1. The HTML rendering of a 510(k) summary is mechanically split into blocks and
   does not faithfully communicate document structure, tables, multi-column
   order, page context, or OCR uncertainty.
2. Many evidence rows contain a nearby literal excerpt but do not convincingly
   demonstrate that the exact normalized sensor, location, signal,
   physiological parameter, derived feature, or output is supported. The cards
   feel like extraction output rather than a rigorous scientific evidence
   record.

Your first assignment is to rethink and prototype the clearance evidence page,
not to make superficial styling changes across the whole site.

Choose one representative clearance with a substantive FDA summary and several
sensor/output claims. Audit its generated JSON against its original FDA PDF.
Then design and implement a single-clearance prototype that:

- presents the FDA document in a high-fidelity, readable section hierarchy;
- supports synchronized PDF/transcript inspection at the page level;
- reconstructs real tables where the source structure is recoverable;
- separates repeated headers, footers, page numbers, and OCR debris from the
  reading view without altering immutable raw extraction;
- presents the device as linked measurement chains:
  physical sensor → location → raw/acquired signal → physiological parameter →
  directly sensed or derived → derived feature → diagnostic/report output;
- gives every populated field its own exact evidence, page, section, block ID,
  source wording, normalized value, interpretation status, and review status;
- makes unsupported or ambiguous relationships obvious instead of filling
  gaps;
- lets a human reviewer accept, edit and verify, reject, or request
  clarification while preserving stable claim IDs;
- preserves JSON/Excel round trips and verified-only Table 8.3 aggregation;
- works both on GitHub Pages under `/evidence-explorer/` and ChatGPT Sites at
  `/`;
- is keyboard accessible and usable on a laptop-sized screen.

Before coding, provide a concise audit of the current schema and explain what
additional document/block/relationship data the faithful design requires. If a
schema migration is needed, design it so existing review decisions and claim
IDs are preserved.

Scientific rules:

- Use only source-supported clearance-level facts.
- The original FDA PDF is the ultimate source.
- A text match is not semantic verification.
- Keep sensors, locations, raw signals, physiological parameters, derived
  features, and reported outputs separate.
- Do not infer PPG waveform from SpO2, a pressure transducer from “airflow,”
  calibrated effort from an effort belt, AHI from apnea/hypopnea detection,
  anatomical location from a sensor name, or a reported output from a recorded
  waveform.
- Preserve `Not stated`, `Not applicable`, `Unreadable`, and blank as distinct
  states.
- Pending, unsupported, rejected, or unreadable claims must never enter Table
  8.3.
- Keep clearance counts and device-family counts separate.
- Keep future manufacturer labeling in a distinct source layer.

Do not commit secrets. There are no custom GitHub Pages secrets. ChatGPT Sites
credentials are temporary and obtained only when publishing. Google Document
AI credentials are not configured, so do not represent the OCR pilot as
complete.

After the prototype is built:

1. run the full test suite and static Pages build;
2. add focused tests for any new document/claim relationships;
3. show exactly how the prototype improves verification over the existing
   page;
4. list unresolved source-data limitations honestly;
5. stop before corpus-wide migration until the prototype is reviewed.

---

