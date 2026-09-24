# v2 structural pipeline (prototype)

Builds a structure-aware evidence record for one clearance from the original FDA
PDF, which lives in the private data root and is never committed. See
`docs/EVIDENCE_SCHEMA_V2.md`.

Requirements: Python 3.11+, `pip install -r pipeline/requirements.txt`,
Poppler (`pdftoppm`), and optionally Tesseract for image-only pages (local OCR,
unreviewed).

```bash
python3 pipeline/curation/author_K143272.py pipeline/curation/K143272.json
python3 pipeline/build_document_v2.py \
  --pdf ../data/regulatory_documents/K143272/K143272_original.pdf \
  --legacy public/evidence_data/documents/K143272.json \
  --v1-packet public/evidence_data/review_packet.json \
  --v2-packet public/evidence_data/v2/review/review_packet_v2.json \
  --curation pipeline/curation/K143272.json \
  --out-dir public/evidence_data/v2
node scripts/v2/build-review-artifacts.mjs
```

The builder:

- checks the PDF SHA-256 against the v1 record;
- keeps v1 pages and blocks verbatim under `legacy`;
- writes nothing if any curated quote fails to resolve to exactly one literal
  location, or if a stated subject claim rests only on a predicate column;
- never creates or changes a review decision. Review fields come from the v2
  packet, then the v1 packet.

Review round trip:

```bash
node scripts/v2/import-review.mjs reviewed.xlsx --check-only
node scripts/v2/import-review.mjs reviewed.xlsx          # merge into the canonical packet
node scripts/v2/import-review.mjs drafts.json            # browser export
```

`pipeline/curation/K143272.json` is a **curator draft** (prototype). It is
evidence-anchored, but none of it is human-reviewed.
