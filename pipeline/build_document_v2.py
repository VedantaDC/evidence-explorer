#!/usr/bin/env python3
"""Build a v2 (structure-aware) evidence record for one FDA 510(k) clearance.

Inputs
  --pdf           original FDA PDF (private data root; never committed)
  --legacy        v1 document JSON from public/evidence_data/documents/
  --v1-packet     v1 canonical review packet (review decisions are preserved)
  --curation      curation proposals for this clearance (pipeline/curation/)
  --v2-packet     existing v2 review packet, if any (takes precedence)
  --out-dir       public/evidence_data/v2/

Outputs
  documents/<K>.json          v2 record (structure + claims + chains + relationships)
  pages/<K>/p-NN.png          page renders for synchronized inspection

The builder never creates or changes a review decision. It refuses to emit an
evidence anchor unless the quote resolves to exactly one literal location.
See docs/EVIDENCE_SCHEMA_V2.md.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

BUILDER_VERSION = "0.1.0-prototype"
CHAIN_FIELDS = [
    "sensor_technology", "sensor_location", "raw_acquired_signal", "physiological_parameter",
    "direct_vs_derived", "derived_reported_feature", "diagnostic_output",
]
# Section 8.2 supplementary factual fields (team extraction guide); not used by Table 8.3 counts.
SUPPLEMENTARY_FIELDS = ["signal_access", "sampling_resolution", "continuity", "synchronization",
                        "calibration", "validation_comparator", "processing_approach"]
VALUE_STATES = {"stated", "Not stated", "Not applicable", "Unreadable", ""}
INTERPRETATIONS_V2 = {"explicit", "normalized", "inferred", "not stated", "unreadable", "contradicted"}
RELATIONS = {"component_of", "located_at", "acquires", "represents", "measures", "derivation",
             "derived_feature_of", "reported_as", "generated_by"}
BASES = {"explicit", "same-cell", "output-name", "inferred", "not-stated"}
PAGE_NUMBER_RE = re.compile(r"\bPage\s+\d+(\s+of\s+\d+)?\s*$", re.I)
LETTER_CONT_RE = re.compile(r"^Page\s+\d+\s+[–-]\s+\S")
BULLET_CHARS = {"•", "▪", "◦", "-", "–", "o", "", "", "", "", ""}
OCR_LOW_CONF = 80


def sha(text: str, n: int = 12) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:n]


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ws_norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def rbox(b) -> list[float]:
    return [round(float(b[0]), 1), round(float(b[1]), 1), round(float(b[2]), 1), round(float(b[3]), 1)]


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def is_bold(fontname: str) -> bool:
    return bool(re.search(r"bold|black|heavy", fontname or "", re.I))


# --------------------------------------------------------------------------- lines


class Line:
    """A visual line: ordered words with geometry and char offsets into `text`."""

    def __init__(self, words: list[dict]):
        self.words = sorted(words, key=lambda w: w["x0"])
        parts, spans, pos = [], [], 0
        prev = None
        for w in self.words:
            if prev is not None:
                gap = w["x0"] - prev["x1"]
                if gap > 1.0:
                    parts.append(" ")
                    pos += 1
            start = pos
            parts.append(w["text"])
            pos += len(w["text"])
            spans.append((start, pos, [w["x0"], w["top"], w["x1"], w["bottom"]], w.get("sup", False)))
            prev = w
        self.text = "".join(parts)
        self.spans = spans
        self.x0 = min(w["x0"] for w in self.words)
        self.x1 = max(w["x1"] for w in self.words)
        self.top = min(w["top"] for w in self.words if not w.get("sup")) if any(not w.get("sup") for w in self.words) else min(w["top"] for w in self.words)
        self.bottom = max(w["bottom"] for w in self.words)
        sizes = [w.get("size", 10) for w in self.words if not w.get("sup")] or [10]
        self.size = Counter(round(s, 1) for s in sizes).most_common(1)[0][0]
        body = [w for w in self.words if not w.get("sup") and w["text"].strip()]
        self.bold = bool(body) and all(is_bold(w.get("fontname", "")) for w in body)
        self.lead_bold = bool(body) and is_bold(body[0].get("fontname", ""))

    @property
    def bbox(self):
        return [self.x0, self.top, self.x1, self.bottom]


def build_lines(words: list[dict], body_size: float) -> list[Line]:
    """Group words into lines by vertical centre; attach superscripts to their host line."""
    small = [w for w in words if w.get("size", body_size) < 0.8 * body_size]
    normal = [w for w in words if w not in small]
    rows: list[list[dict]] = []
    for w in sorted(normal, key=lambda w: (w["top"], w["x0"])):
        cy = (w["top"] + w["bottom"]) / 2
        for row in rows:
            top = min(x["top"] for x in row)
            bottom = max(x["bottom"] for x in row)
            if top - 0.5 <= cy <= bottom + 0.5:
                row.append(w)
                break
        else:
            rows.append([w])
    for w in small:
        host = None
        for row in rows:
            top = min(x["top"] for x in row)
            bottom = max(x["bottom"] for x in row)
            adjacent = any(abs(w["x0"] - x["x1"]) < 2.5 or abs(x["x0"] - w["x1"]) < 2.5 for x in row)
            if adjacent and top - 5 <= w["bottom"] <= bottom + 1 and w["top"] < bottom:
                host = row
                break
        if host is not None:
            host.append({**w, "sup": True})
        else:
            rows.append([w])
    lines = [Line(r) for r in rows]
    return sorted(lines, key=lambda l: (round(l.top), l.x0))


# --------------------------------------------------------------------------- text units


class Unit:
    """A text-bearing unit (block or table-cell segment) with an addressable text."""

    def __init__(self, uid: str, kind: str, page: int):
        self.id = uid
        self.kind = kind
        self.page = page
        self.lines: list[dict] = []
        self.word_spans: list[tuple[int, int, list[float], int]] = []  # (start,end,bbox,page)
        self.text = ""
        self.scope = "document"

    def add_line(self, line: Line, page: int, para_break: bool = False, extra: dict | None = None):
        if self.text:
            self.text += "\n"
        base = len(self.text)
        self.text += line.text
        entry = {"text": line.text, "bbox": rbox(line.bbox), "page": page}
        sup = [[s, e] for (s, e, _, is_sup) in line.spans if is_sup]
        if sup:
            entry["sup"] = sup
        if para_break:
            entry["para_break"] = True
        if extra:
            entry.update(extra)
        self.lines.append(entry)
        for (s, e, b, _) in line.spans:
            self.word_spans.append((base + s, base + e, b, page))
        return base


# --------------------------------------------------------------------------- OCR


def ocr_page(pdf_path: Path, page_no: int, dpi: int = 300) -> dict | None:
    if not shutil.which("tesseract") or not shutil.which("pdftoppm"):
        return None
    with tempfile.TemporaryDirectory() as tmp:
        stem = Path(tmp) / "p"
        subprocess.run(["pdftoppm", "-f", str(page_no), "-l", str(page_no), "-r", str(dpi), "-gray", "-png",
                        str(pdf_path), str(stem)], check=True, capture_output=True)
        png = next(Path(tmp).glob("p*.png"))
        subprocess.run(["tesseract", str(png), str(stem), "--psm", "4", "tsv"], check=True, capture_output=True)
        version = subprocess.run(["tesseract", "--version"], capture_output=True, text=True).stdout.splitlines()[0]
        rows = list(csv.DictReader((stem.with_suffix(".tsv")).open(encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE))
    scale = 72.0 / dpi
    words = []
    for r in rows:
        if r["level"] != "5" or not r["text"].strip():
            continue
        x, y, w, h = (int(r[k]) for k in ("left", "top", "width", "height"))
        words.append({
            "text": r["text"], "conf": round(float(r["conf"]), 1),
            "x0": x * scale, "top": y * scale, "x1": (x + w) * scale, "bottom": (y + h) * scale,
            "key": (int(r["block_num"]), int(r["par_num"]), int(r["line_num"])),
        })
    return {"engine": version, "dpi": dpi, "psm": 4, "words": words}


# --------------------------------------------------------------------------- builder


class Builder:
    def __init__(self, args):
        self.args = args
        self.pdf_path = Path(args.pdf)
        self.legacy = json.loads(Path(args.legacy).read_text())
        self.k = self.legacy["document"]["k_number"]
        self.curation = json.loads(Path(args.curation).read_text()) if args.curation else None
        self.units: dict[str, Unit] = {}
        self.blocks: list[dict] = []
        self.artifacts: list[dict] = []
        self.pages: list[dict] = []
        self.parts: list[dict] = []
        self.sections: list[dict] = []
        self.tables: list[dict] = []
        self.errors: list[str] = []

    # ---------------------------------------------------------------- structure

    def run_structure(self):
        pdf = pdfplumber.open(str(self.pdf_path))
        repeated = self._repeated_band_lines(pdf)
        current_part = None
        comparison = None
        section_stack: list[dict] = []
        order = 0
        for pno, page in enumerate(pdf.pages, start=1):
            W, H = float(page.width), float(page.height)
            words = page.extract_words(extra_attrs=["fontname", "size"], x_tolerance=2.5, y_tolerance=2)
            sizes = Counter(round(w["size"], 1) for w in words for _ in w["text"])
            body = sizes.most_common(1)[0][0] if sizes else 10.0
            images = [{"bbox": [i["x0"], i["top"], i["x1"], i["bottom"]]} for i in page.images]
            img_cov = max([((b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1])) / (W * H) for b in images] or [0])
            tables = [t for t in page.find_tables() if len(t.rows) >= 2 and max(len(r.cells) for r in t.rows) >= 2]
            table_boxes = [t.bbox for t in tables]
            in_table = lambda w: any(tb[0] <= (w["x0"] + w["x1"]) / 2 <= tb[2] and tb[1] <= (w["top"] + w["bottom"]) / 2 <= tb[3] for tb in table_boxes)
            flow_words = [w for w in words if not in_table(w)]
            lines = build_lines(flow_words, body)

            page_label = ""
            content_lines: list[Line] = []
            for ln in lines:
                band = ln.top < 0.09 * H or ln.bottom > 0.91 * H
                if not band and ln.top > 0.88 * H and PAGE_NUMBER_RE.search(ln.text):
                    band = True
                norm = re.sub(r"\d+", "#", ws_norm(ln.text))
                role = None
                if band and PAGE_NUMBER_RE.search(ln.text):
                    role = "page_number" if PAGE_NUMBER_RE.fullmatch(ln.text.strip()) else "running_footer"
                    page_label = PAGE_NUMBER_RE.search(ln.text).group(0).strip()
                elif band and norm in repeated:
                    role = "running_header" if ln.top < 0.5 * H else "running_footer"
                elif LETTER_CONT_RE.match(ln.text) and ln.top < 0.12 * H:
                    role = "letter_continuation"
                if role:
                    self.artifacts.append({"artifact_id": f"{self.k}-V2-P{pno:03d}-A{len([a for a in self.artifacts if a['page'] == pno]) + 1:02d}",
                                           "page": pno, "role": role, "text": ln.text, "bbox": rbox(ln.bbox)})
                else:
                    content_lines.append(ln)
            for im in images:
                b = im["bbox"]
                area = ((b[2] - b[0]) * (b[3] - b[1])) / (W * H)
                role = "image_region" if area > 0.5 else ("logo" if b[1] < 0.2 * H and area < 0.05 else "decorative_image")
                self.artifacts.append({"artifact_id": f"{self.k}-V2-P{pno:03d}-A{len([a for a in self.artifacts if a['page'] == pno]) + 1:02d}",
                                       "page": pno, "role": role, "text": "", "bbox": rbox(b)})

            native_chars = sum(len(l.text) for l in content_lines)
            text_layer = "native"
            ocr = None
            if img_cov > 0.5 and native_chars < 300:
                text_layer = "image-only (native text layer holds only artifacts/stamps)"
                ocr = ocr_page(self.pdf_path, pno)

            # ---- part detection
            page_text = " ".join(l.text for l in content_lines)
            ocr_text = " ".join(w["text"] for w in (ocr or {}).get("words", []))
            new_part = None
            if re.search(r"\bRe:\s*K\d{6}", page_text) and re.search(r"\bDear\b", page_text):
                new_part = ("letter", "FDA substantial-equivalence letter", "inferred")
            elif ocr and re.search(r"Indications\s+for\s+Use", ocr_text) and re.search(r"FORM\s+FDA\s+3881", ocr_text):
                new_part = ("ifu_form", "Indications for Use (Form FDA 3881)", "ocr")
            else:
                for l in content_lines:
                    if re.search(r"510\(k\)\s+Summary", l.text) and (l.bold or l.size >= body + 2):
                        new_part = ("summary", ws_norm(l.text), "source")
                        break
            if new_part or current_part is None:
                kind, title, src = new_part or ("document", "Document", "inferred")
                current_part = {"part_id": f"{self.k}-V2-PART{len(self.parts) + 1}", "kind": kind, "title": title,
                                "title_source": src, "pages": []}
                self.parts.append(current_part)
                sec = self._new_section(current_part, None, 0, title, src, pno)
                section_stack = [sec]
                comparison = None if kind != "summary" else comparison
            current_part["pages"].append(pno)

            self.pages.append({
                "page": pno, "width": round(W, 2), "height": round(H, 2),
                "orientation": "landscape" if W > H else "portrait", "page_label": page_label,
                "part_id": current_part["part_id"], "text_layer": text_layer,
                "image_coverage": round(img_cov, 3), "body_font_size": body,
                "render": f"pages/{self.k}/p-{pno:02d}.png",
                "tables_detected": len(tables),
            })

            # ---- flow blocks (above tables first, then tables, then below; by vertical order)
            items = [("line", l.top, l) for l in content_lines] + [("table", t.bbox[1], t) for t in tables]
            items.sort(key=lambda x: x[1])
            pending: list[Line] = []

            def flush():
                nonlocal pending, order
                if pending:
                    order = self._emit_flow(pending, pno, current_part, section_stack, body, order)
                pending = []

            for kind, _, obj in items:
                if kind == "line":
                    pending.append(obj)
                else:
                    flush()
                    comparison = self._emit_table(page, pno, obj, words, body, comparison, section_stack, order)
                    order += 1
            flush()
            if ocr:
                order = self._emit_ocr(ocr, pno, content_lines, section_stack, order)
                self.pages[-1]["ocr"] = {"engine": ocr["engine"], "dpi": ocr["dpi"], "psm": ocr["psm"],
                                         "words": len(ocr["words"]),
                                         "mean_conf": round(sum(w["conf"] for w in ocr["words"]) / max(1, len(ocr["words"])), 1),
                                         "low_conf_words": sum(1 for w in ocr["words"] if w["conf"] < OCR_LOW_CONF)}
        for s in self.sections:
            if s["page_end"] is None:
                s["page_end"] = s["page_start"]

    def _repeated_band_lines(self, pdf) -> set[str]:
        counts: Counter = Counter()
        for page in pdf.pages:
            H = float(page.height)
            words = page.extract_words(extra_attrs=["fontname", "size"], x_tolerance=2.5, y_tolerance=2)
            sizes = Counter(round(w["size"], 1) for w in words)
            body = sizes.most_common(1)[0][0] if sizes else 10
            seen = set()
            for ln in build_lines(words, body):
                if ln.top < 0.09 * H or ln.bottom > 0.91 * H:
                    seen.add(re.sub(r"\d+", "#", ws_norm(ln.text)))
            counts.update(seen)
        return {t for t, c in counts.items() if c >= 3}

    def _new_section(self, part, parent, level, title, title_source, page):
        sec = {"section_id": f"{self.k}-V2-S{len(self.sections) + 1:02d}", "part_id": part["part_id"],
               "parent_id": parent["section_id"] if parent else None, "level": level, "title": title,
               "title_source": title_source, "page_start": page, "page_end": page, "block_ids": []}
        self.sections.append(sec)
        return sec

    def _touch(self, sec_stack, page):
        for s in sec_stack:
            s["page_end"] = max(s["page_end"] or page, page)

    def _block_id(self, page):
        n = len([b for b in self.blocks if b["page"] == page]) + 1
        return f"{self.k}-V2-P{page:03d}-B{n:03d}"

    def _add_block(self, unit: Unit, btype: str, section_stack, order, **extra):
        sec = section_stack[-1]
        bbox = union([l["bbox"] for l in unit.lines])
        block = {"block_id": unit.id, "page": unit.page, "pages": sorted({l["page"] for l in unit.lines}),
                 "section_id": sec["section_id"], "order": order, "type": btype, "text": unit.text,
                 "lines": unit.lines, "bbox": rbox(bbox) if bbox else None, "text_layer": extra.pop("text_layer", "native")}
        block.update(extra)
        self.blocks.append(block)
        self.units[unit.id] = unit
        sec["block_ids"].append(unit.id)
        self._touch(section_stack, unit.page)
        return block

    def _emit_flow(self, lines: list[Line], page, part, section_stack, body, order):
        groups: list[tuple[str, list[Line], dict]] = []
        prev = None
        spacing = [b.top - a.top for a, b in zip(lines, lines[1:]) if 0 < b.top - a.top < 3 * body]
        typical = sorted(spacing)[len(spacing) // 2] if spacing else body * 1.2
        kv_x = self._kv_value_column(lines)
        in_signature = False
        for ln in lines:
            txt = ln.text.strip()
            first = ln.words[0]["text"]
            is_heading = (ln.bold or ln.size >= body + 2) and len(txt) < 70 and not txt.endswith(".") and not txt.endswith(":")
            is_bullet = first in BULLET_CHARS or (first and ord(first[0]) >= 0xF000)
            gap = (ln.top - prev.top) if prev else 0
            new_para = prev is None or gap > typical * 1.45 or abs(ln.x0 - prev.x0) > 60 and not kv_x
            if txt.startswith("Sincerely"):
                in_signature = True
                groups.append(("signature", [ln], {}))
            elif in_signature:
                if txt == "Enclosure":
                    in_signature = False
                    groups.append(("paragraph", [ln], {}))
                else:
                    groups[-1][1].append(ln)
            elif part["kind"] == "letter" and page == part["pages"][0] and ln.top < 0.16 * float(self._page_h(page)):
                if groups and groups[-1][0] == "letterhead":
                    groups[-1][1].append(ln)
                else:
                    groups.append(("letterhead", [ln], {}))
            elif is_heading:
                groups.append(("heading", [ln], {"level": 1 if ln.size >= body + 1.5 else 2}))
            elif is_bullet:
                level = 1 if not groups or groups[-1][0] != "list_item" else (2 if ln.x0 > groups[-1][2]["x"] + 20 else groups[-1][2]["level"] if abs(ln.x0 - groups[-1][2]["x"]) < 20 else 1)
                groups.append(("list_item", [ln], {"level": level, "x": ln.x0, "marker": first}))
            elif kv_x and (abs(ln.x0 - kv_x) < 4 or any(abs(w["x0"] - kv_x) < 4 for w in ln.words[1:])):
                groups.append(("kv", [ln], {}))
            elif groups and groups[-1][0] == "list_item" and not new_para and ln.x0 > groups[-1][2]["x"] + 5:
                groups[-1][1].append(ln)
            elif groups and groups[-1][0] in ("paragraph",) and not new_para:
                groups[-1][1].append(ln)
            else:
                groups.append(("paragraph", [ln], {}))
            prev = ln

        kv_rows = [g for g in groups if g[0] == "kv"]
        emitted_kv = False
        for gtype, glines, meta in groups:
            if gtype == "kv":
                if not emitted_kv:
                    self._emit_kv_table(kv_rows, kv_x, page, section_stack, order)
                    order += 1
                    emitted_kv = True
                continue
            if gtype == "heading":
                txt = ws_norm(glines[0].text)
                parent_level = meta["level"]
                while len(section_stack) > 1 and section_stack[-1]["level"] >= parent_level:
                    section_stack.pop()
                if self.parts[-1]["title"] != txt:
                    sec = self._new_section(self.parts[-1], section_stack[-1], parent_level, txt, "source", page)
                    section_stack.append(sec)
            unit = Unit(self._block_id(page), "block", page)
            for i, ln in enumerate(glines):
                words = ln.words
                if gtype == "list_item" and i == 0:
                    ln = Line(words[1:]) if len(words) > 1 else ln
                unit.add_line(ln, page)
            extra = {}
            if gtype == "heading":
                extra["level"] = meta["level"]
            if gtype == "list_item":
                extra.update({"level": meta["level"], "marker_raw": meta["marker"]})
            if gtype == "paragraph" and glines[0].lead_bold and re.match(r"^[A-Z][\w ]{2,30}:", glines[0].text):
                extra["lead_in"] = glines[0].text.split(":")[0]
            if gtype in ("letterhead", "signature") or (gtype == "paragraph" and self._looks_like_address(glines)):
                extra["preserve_lines"] = True
            if gtype == "signature":
                extra["layout_note"] = "Digital-signature stamp overlaps the typed signature; line order is approximate."
            self._add_block(unit, gtype, section_stack, order, **extra)
            order += 1
        return order

    def _page_h(self, page):
        return next(p["height"] for p in self.pages if p["page"] == page)

    @staticmethod
    def _looks_like_address(lines: list[Line]) -> bool:
        if len(lines) < 2:
            return False
        short = sum(1 for l in lines if len(l.text) < 60)
        sentence_like = sum(1 for l in lines[:-1] if re.search(r"[a-z]{3,}\.$", l.text.rstrip()))
        return short == len(lines) and sentence_like == 0

    @staticmethod
    def _kv_value_column(lines: list[Line]):
        """Detect a two-column label/value layout aligned by whitespace (no rules)."""
        xs = []
        for ln in lines:
            for a, b in zip(ln.words, ln.words[1:]):
                if b["x0"] - a["x1"] > 40 and ln.words[0]["x0"] < 100:
                    xs.append(round(b["x0"]))
                    break
        if len(xs) < 4:
            return None
        x, n = Counter(xs).most_common(1)[0]
        return x if n >= 4 else None

    def _emit_kv_table(self, kv_groups, kv_x, page, section_stack, order):
        table_id = f"{self.k}-V2-T{len(self.tables) + 1:02d}"
        rows = []
        for _, glines, _ in kv_groups:
            ln = glines[0]
            left = [w for w in ln.words if w["x0"] < kv_x - 4]
            right = [w for w in ln.words if w["x0"] >= kv_x - 4]
            if left:
                rows.append({"label_words": left, "value_lines": [right] if right else []})
            elif rows:
                rows[-1]["value_lines"].append(right)
        out_rows = []
        for i, r in enumerate(rows, start=1):
            row_id = f"{table_id}-R{i:02d}"
            label_unit = Unit(f"{row_id}-C1", "cell", page)
            label_unit.add_line(Line(r["label_words"]), page)
            val_unit = Unit(f"{row_id}-C2", "cell", page)
            for vw in r["value_lines"]:
                val_unit.add_line(Line(vw), page)
            cells = []
            for unit, col, scope in ((label_unit, "C1", "characteristic"), (val_unit, "C2", "subject")):
                unit.scope = scope
                self.units[unit.id] = unit
                cells.append({"cell_id": unit.id, "col_ids": [col], "scope": scope, "text": unit.text,
                              "segments": [{"page": page, "bbox": rbox(union([l["bbox"] for l in unit.lines]) or [0, 0, 0, 0]),
                                            "char_start": 0, "char_end": len(unit.text), "lines": unit.lines}]})
            out_rows.append({"row_id": row_id, "label": ws_norm(label_unit.text), "pages": [page], "cells": cells})
        table = {"table_id": table_id, "kind": "key_value", "section_id": section_stack[-1]["section_id"], "pages": [page],
                 "title": "Submission identification (label/value list)", "title_source": "inferred",
                 "structure_method": "whitespace alignment of label and value columns (no ruling lines)",
                 "structure_confidence": "medium",
                 "columns": [{"col_id": "C1", "label": "Item", "role": "characteristic"},
                             {"col_id": "C2", "label": "Value", "role": "subject", "device": self.legacy["document"]["device_name"], "k_number": self.k}],
                 "rows": out_rows}
        self.tables.append(table)
        blk = {"block_id": f"{table_id}-REF", "page": page, "pages": [page], "section_id": section_stack[-1]["section_id"],
               "order": order, "type": "table_ref", "table_id": table_id, "text": "", "lines": [], "bbox": None, "text_layer": "native"}
        self.blocks.append(blk)
        section_stack[-1]["block_ids"].append(blk["block_id"])

    def _col_roles(self, header_texts: list[str], group_texts: list[str], ncols: int) -> list[str]:
        doc = self.legacy["document"]
        name = re.sub(r"[^a-z0-9]+", " ", doc["device_name"].lower()).strip()
        roles = []
        for i in range(ncols):
            own, grp = header_texts[i], group_texts[i]
            both = f"{grp} {own}"
            ks = re.findall(r"K\d{6}", both)
            norm = re.sub(r"[^a-z0-9]+", " ", own.lower()).strip()
            if i == 0 and not ks and not re.search(r"subject|predicate|proposed|new device", both, re.I):
                roles.append("characteristic")
            elif re.search(r"\bcomments?\b|comparison|discussion|differences?|similarit|remarks?|equivalen", own, re.I) and not ks:
                roles.append("comment")
            elif self.k in ks:
                roles.append("subject")
            elif ks:
                roles.append("predicate")
            elif re.search(r"\bsubject\b|\bnew device\b|\bproposed\b|\bmodified\b", both, re.I):
                roles.append("subject")
            elif re.search(r"predicate|reference device", both, re.I):
                roles.append("predicate")
            elif name and norm and (norm in name or name in norm):
                roles.append("subject")
            else:
                roles.append("unknown")
        return roles

    def _emit_table(self, page, pno, table, words, body, prev, section_stack, order):
        """Emit one detected table; returns the logical table it was added to (for page continuation)."""
        cells = [c for c in table.cells if (c[2] - c[0]) > 12 and (c[3] - c[1]) > 6]
        tb_words = [w for w in words if table.bbox[0] <= (w["x0"] + w["x1"]) / 2 <= table.bbox[2] and table.bbox[1] <= (w["top"] + w["bottom"]) / 2 <= table.bbox[3]]

        def words_in(c):
            return [w for w in tb_words if c[0] <= (w["x0"] + w["x1"]) / 2 <= c[2] and c[1] <= (w["top"] + w["bottom"]) / 2 <= c[3]]

        def text_of(c):
            ws = words_in(c)
            return ws_norm(" ".join(l.text for l in build_lines(ws, body))) if ws else ""

        rows_raw: dict[int, list] = {}
        for c in cells:
            key = next((k for k in rows_raw if abs(k - c[1]) < 2), round(c[1]))
            rows_raw.setdefault(key, []).append(c)
        tops = sorted(rows_raw)
        # header rows (text-only test, before the grid exists): first row, plus following short rows
        # whose leftmost cell is empty or header-like
        header_n = 0
        for i, t in enumerate(tops[:4]):
            texts = [text_of(c) for c in rows_raw[t]]
            first = text_of(min(rows_raw[t], key=lambda c: c[0]))
            short = all(len(x) <= 45 for x in texts)
            if i == 0 and short:
                header_n = 1
            elif header_n == i and short and (not first or first.isupper() or re.fullmatch(r"\(?K\d{6}\)?", first or "")) and any(texts):
                header_n = i + 1
            else:
                break
        # column grid: x0 edges that recur across body rows (padding rectangles in header rows are ignored)
        grid_tops = tops[header_n:] or tops
        freq: Counter = Counter()
        for t in grid_tops:
            for x in {round(c[0] / 3) * 3 for c in rows_raw[t]}:
                freq[x] += 1
        need = 2 if len(grid_tops) >= 3 else 1
        edges = sorted(x for x, n in freq.items() if n >= need) or sorted(freq)
        left = min(round(c[0] / 3) * 3 for c in cells)
        if edges[0] != left:
            edges = [left] + edges
        merged = []
        for x in edges:
            if not merged or x - merged[-1] > 8:
                merged.append(x)
        right = max(c[2] for c in cells)
        bounds = list(zip(merged, merged[1:] + [right]))
        # a table on the next page whose edges all fall on the previous grid continues that grid
        if prev is not None and prev["pages"][-1] in (pno, pno - 1):
            prev_edges = [a for a, _ in prev["_bounds"]]
            if all(any(abs(x - e) < 6 for e in prev_edges) for x in merged) and abs(right - prev["_bounds"][-1][1]) < 6:
                bounds = prev["_bounds"]

        def cols_of(c):
            out = [i for i, (a, b) in enumerate(bounds) if max(0, min(c[2], b) - max(c[0], a)) >= 0.6 * (b - a)]
            if not out:
                cx = (c[0] + c[2]) / 2
                out = [min(range(len(bounds)), key=lambda i: abs((bounds[i][0] + bounds[i][1]) / 2 - cx))]
            return out

        row_sig = lambda t: ws_norm(" ".join(text_of(c) for c in sorted(rows_raw[t], key=lambda c: c[0]))).lower()
        if prev is not None and prev["pages"][-1] in (pno, pno - 1) and prev.get("_header_rows"):
            # on a continuation page, header rows are exactly those repeating the previous table's header
            n = 0
            while n < len(tops) and n < len(prev["_header_rows"]) and row_sig(tops[n]) == prev["_header_rows"][n]:
                n += 1
            if n:
                header_n = n
        header_rows = [rows_raw[t] for t in tops[:header_n]]
        header_sig = ws_norm(" ".join(text_of(c) for r in header_rows for c in sorted(r, key=lambda c: c[0]))).lower()

        same_grid = prev is not None and len(prev["_bounds"]) == len(bounds) and all(abs(a[0] - b[0]) < 6 for a, b in zip(prev["_bounds"], bounds)) \
            and prev["pages"][-1] in (pno, pno - 1)
        continuation = same_grid and (header_n == 0 or header_sig == prev["_header_sig"] or not header_sig)
        if continuation:
            tbl = prev
            body_tops = tops[header_n:] if header_sig == prev["_header_sig"] else tops
            if header_n:
                tbl["repeated_header_pages"].append(pno)
        else:
            ncols = len(bounds)
            hdr = [[] for _ in range(ncols)]
            grp = ["" for _ in range(ncols)]
            for r in header_rows:
                for c in r:
                    txt = text_of(c)
                    ids = cols_of(c)
                    if not txt:
                        continue
                    if len(ids) > 1:
                        for i in ids:
                            grp[i] = ws_norm(f"{grp[i]} {txt}")
                    else:
                        hdr[ids[0]].append(txt)
            labels = [ws_norm(" ".join(dict.fromkeys(h))) for h in hdr]
            roles = self._col_roles(labels, grp, ncols)
            columns = []
            for i in range(ncols):
                km = re.search(r"K\d{6}", f"{grp[i]} {labels[i]}")
                columns.append({"col_id": f"C{i + 1}", "label": labels[i], "group": grp[i], "role": roles[i],
                                "device": re.sub(r"\s*\(?K\d{6}\)?", "", labels[i]).strip() if i else "",
                                "k_number": km.group(0) if km else (self.k if roles[i] == "subject" else "")})
            kind = "comparison" if {"subject", "predicate"} & set(roles) else ("grid" if header_n else "grid (no header)")
            table_id = f"{self.k}-V2-T{len(self.tables) + 1:02d}"
            tbl = {"table_id": table_id, "kind": kind, "section_id": section_stack[-1]["section_id"], "pages": [],
                   "title": "Substantial-equivalence comparison table" if kind == "comparison" else "Table", "title_source": "inferred",
                   "structure_method": "vector cell rectangles (pdfplumber find_tables); column grid from recurring cell edges; header rows and column roles from header text",
                   "structure_confidence": "high" if kind == "comparison" and "unknown" not in roles else "medium",
                   "columns": columns, "rows": [], "_bounds": bounds, "_header_sig": header_sig, "_header_rows": [row_sig(t) for t in tops[:header_n]],
                   "repeated_header_pages": []}
            self.tables.append(tbl)
            blk = {"block_id": f"{table_id}-REF", "page": pno, "pages": [pno], "section_id": section_stack[-1]["section_id"],
                   "order": order, "type": "table_ref", "table_id": table_id, "text": "", "lines": [], "bbox": None, "text_layer": "native"}
            self.blocks.append(blk)
            section_stack[-1]["block_ids"].append(blk["block_id"])
            body_tops = tops[header_n:]
        if pno not in tbl["pages"]:
            tbl["pages"].append(pno)
        self._touch(section_stack, pno)
        columns = tbl["columns"]
        first = True
        for top in body_tops:
            rcells = sorted(rows_raw[top], key=lambda c: c[0])
            if not any(words_in(c) for c in rcells):
                continue
            label_cell = next((c for c in rcells if cols_of(c) == [0]), None)
            label = text_of(label_cell) if label_cell else ""
            cont = first and continuation and tbl["rows"] and (not label or label[0].islower() or label[0] in ")]")
            first = False
            if cont:
                row = tbl["rows"][-1]
                if pno not in row["pages"]:
                    row["pages"].append(pno)
                if label:
                    row["label"] = ws_norm(row["label"] + " " + label)
            else:
                row = {"row_id": f"{tbl['table_id']}-R{len(tbl['rows']) + 1:02d}", "label": label, "pages": [pno], "cells": []}
                tbl["rows"].append(row)
            for c in rcells:
                ids = cols_of(c)
                cw = words_in(c)
                col_ids = [columns[i]["col_id"] for i in ids if i < len(columns)]
                if not col_ids:
                    continue
                roles = {columns[i]["role"] for i in ids if i < len(columns)}
                scope = ("characteristic" if roles == {"characteristic"} else "comment" if roles == {"comment"} else
                         "subject" if roles == {"subject"} else "predicate" if roles == {"predicate"} else
                         "shared" if "subject" in roles else "unknown" if "unknown" in roles else "predicate")
                cell = next((x for x in row["cells"] if x["col_ids"] == col_ids), None)
                if cell is None:
                    cell = {"cell_id": f"{row['row_id']}-{'-'.join(col_ids)}", "col_ids": col_ids, "scope": scope, "text": "", "segments": []}
                    row["cells"].append(cell)
                    unit = Unit(cell["cell_id"], "cell", pno)
                    unit.scope = scope
                    self.units[unit.id] = unit
                unit = self.units[cell["cell_id"]]
                if not cw:
                    continue
                seg_start = len(unit.text) + (1 if unit.text else 0)
                prev_ln = None
                for ln in build_lines(cw, body):
                    unit.add_line(ln, pno, para_break=prev_ln is not None and (ln.top - prev_ln.bottom) > 0.6 * body)
                    prev_ln = ln
                cell["text"] = unit.text
                cell["segments"].append({"page": pno, "bbox": rbox(c), "char_start": seg_start, "char_end": len(unit.text),
                                         "lines": [l for l in unit.lines if l["page"] == pno]})
        return tbl

    def _emit_ocr(self, ocr, page, native_lines: list[Line], section_stack, order):
        native_boxes = [l.bbox for l in native_lines] + [a["bbox"] for a in self.artifacts if a["page"] == page and a["text"]]
        groups: dict = {}
        for w in ocr["words"]:
            groups.setdefault(w["key"], []).append(w)

        def overlaps(b):
            for nb in native_boxes:
                ix = max(0, min(b[2], nb[2]) - max(b[0], nb[0]))
                iy = max(0, min(b[3], nb[3]) - max(b[1], nb[1]))
                if ix * iy > 0.3 * max(1e-6, (b[2] - b[0]) * (b[3] - b[1])):
                    return True
            return False

        paras: dict = {}
        H = self._page_h(page)
        for key, ws in sorted(groups.items()):
            ln = Line([{**w, "size": 10, "fontname": "OCR"} for w in ws])
            if overlaps(ln.bbox):
                continue
            if ln.top > 0.9 * H:
                self.artifacts.append({"artifact_id": f"{self.k}-V2-P{page:03d}-A{len([a for a in self.artifacts if a['page'] == page]) + 1:02d}",
                                       "page": page, "role": "form_footer", "text": ln.text, "bbox": rbox(ln.bbox),
                                       "text_layer": "ocr_local_tesseract", "ocr_min_conf": min(w["conf"] for w in ws)})
                continue
            paras.setdefault(key[:2], []).append((ln, ws))
        for key in sorted(paras):
            unit = Unit(f"{self.k}-V2-P{page:03d}-O{len(paras) and list(sorted(paras)).index(key) + 1:03d}", "block", page)
            confs = []
            for ln, ws in paras[key]:
                base = unit.add_line(ln, page)
                entry = unit.lines[-1]
                entry["ocr_words"] = [[s + base, e + base, next(w["conf"] for w in ws if abs(w["x0"] - b[0]) < 0.01)] for (s, e, b, _) in ln.spans]
                confs.extend(w["conf"] for w in ws)
            self._add_block(unit, "ocr_text", section_stack, order, text_layer="ocr_local_tesseract", preserve_lines=True,
                            ocr_min_conf=min(confs), ocr_mean_conf=round(sum(confs) / len(confs), 1),
                            ocr_low_conf_words=sum(1 for c in confs if c < OCR_LOW_CONF))
            order += 1
        return order

    def dump_units(self) -> str:
        """Reading-order text for extraction agents: every unit with its ID, page, section, and table context."""
        doc = self.legacy["document"]
        out = [f"# {self.k} · {doc['device_name']} · {doc['applicant']} · {doc['product_code']} · decided {doc['decision_date']}",
               "Each unit below is quotable. Cite evidence as {\"unit\": \"<ID>\", \"quote\": \"<exact text>\"}.",
               "Table cells show [scope]: subject = this device; predicate = a comparison device (NEVER evidence for this device); "
               "shared = merged cell spanning the subject column; comment = applicant commentary; unknown = column role could not be established.", ""]
        sec_title = {s["section_id"]: s["title"] for s in self.sections}
        pages = {p["page"]: p for p in self.pages}
        for part in self.parts:
            out.append(f"\n==== PART: {part['title']} (pp. {part['pages'][0]}-{part['pages'][-1]}) ====")
            blocks = sorted([b for b in self.blocks if next((s for s in self.sections if s["section_id"] == b["section_id"]), {}).get("part_id") == part["part_id"]],
                            key=lambda b: (b["page"], b["order"]))
            for b in blocks:
                if b["type"] == "table_ref":
                    t = next(t for t in self.tables if t["table_id"] == b["table_id"])
                    cols = "; ".join(f"{c['col_id']}={c['label'] or '(no label)'} [{c['role']}{' ' + c['k_number'] if c.get('k_number') else ''}]" for c in t["columns"])
                    out.append(f"\n--- TABLE {t['table_id']} ({t['kind']}, pp. {','.join(map(str, t['pages']))}) columns: {cols}")
                    for r in t["rows"]:
                        out.append(f"  ROW {r['row_id']} \"{r['label']}\" (pp. {','.join(map(str, r['pages']))})")
                        for c in r["cells"]:
                            if c["cell_id"].endswith("-C1") and c["col_ids"] == ["C1"]:
                                continue
                            txt = ws_norm(c["text"])
                            if txt:
                                out.append(f"    [{c['scope']}] {c['cell_id']} ({'+'.join(c['col_ids'])}): {txt}")
                    continue
                layer = "" if b["text_layer"] == "native" else f" [{b['text_layer']}, min conf {b.get('ocr_min_conf')}]"
                out.append(f"\n[{b['type']}] {b['block_id']} (p{b['page']}, §{sec_title.get(b['section_id'], '')}){layer}\n{ws_norm(b['text']) if not b.get('preserve_lines') else b['text']}")
        img = [p["page"] for p in self.pages if p["text_layer"] != "native"]
        if img:
            out.append(f"\nNOTE: pages {img} are image-only; their text above is local OCR and may contain errors. Check the PDF page image.")
        return "\n".join(out) + "\n"

    # ---------------------------------------------------------------- legacy mapping

    def map_legacy_blocks(self):
        tok = lambda s: set(re.findall(r"[a-z0-9]{3,}", s.lower()))
        legacy_by_page: dict[int, list] = {}
        for b in self.legacy["blocks"]:
            legacy_by_page.setdefault(b["page"], []).append((b["block_id"], tok(b["text"])))
        for b in self.blocks:
            if not b["text"]:
                continue
            t = tok(b["text"])
            if not t:
                b["legacy_block_ids"] = []
                continue
            b["legacy_block_ids"] = [lid for lid, lt in legacy_by_page.get(b["page"], []) if len(t & lt) / len(t) >= 0.6]
        for tbl in self.tables:
            for row in tbl["rows"]:
                for cell in row["cells"]:
                    t = tok(cell["text"])
                    ids = set()
                    for seg in cell["segments"]:
                        for lid, lt in legacy_by_page.get(seg["page"], []):
                            if t and len(t & lt) / len(t) >= 0.6:
                                ids.add(lid)
                    cell["legacy_block_ids"] = sorted(ids)

    # ---------------------------------------------------------------- anchors

    def _targets(self, loc: dict):
        """Candidate (unit, meta) pairs for a curation locator."""
        out = []
        if "unit" in loc:
            u = self.units.get(loc["unit"])
            if not u:
                return []
            blk = next((b for b in self.blocks if b["block_id"] == u.id), None)
            if blk:
                return [(u, {"kind": "block", "id": u.id, "scope": "document", "section_id": blk["section_id"]})]
            for tbl in self.tables:
                for row in tbl["rows"]:
                    for cell in row["cells"]:
                        if cell["cell_id"] == u.id:
                            return [(u, {"kind": "table_cell", "id": u.id, "table_id": tbl["table_id"], "row_id": row["row_id"], "row_label": row["label"],
                                         "col_ids": cell["col_ids"], "scope": cell["scope"], "section_id": tbl["section_id"]})]
            return []
        if "table_row" in loc:
            for tbl in [t for t in self.tables if t["kind"].startswith(loc.get("table", ""))]:
                role_of = {c["col_id"]: c["role"] for c in tbl["columns"]}
                for row in tbl["rows"]:
                    if ws_norm(row["label"]).lower() != ws_norm(loc["table_row"]).lower():
                        continue
                    for cell in row["cells"]:
                        roles = {role_of[c] for c in cell["col_ids"]}
                        want = loc.get("col")
                        if want and want not in roles:
                            continue
                        out.append((self.units[cell["cell_id"]], {"kind": "table_cell", "id": cell["cell_id"], "table_id": tbl["table_id"],
                                                                   "row_id": row["row_id"], "row_label": row["label"], "col_ids": cell["col_ids"],
                                                                   "scope": cell["scope"], "section_id": tbl["section_id"]}))
            return out
        sec_ids = None
        if "section" in loc:
            sec_ids = {s["section_id"] for s in self.sections if s["title"].lower() == loc["section"].lower()}
            # include descendants
            changed = True
            while changed:
                changed = False
                for s in self.sections:
                    if s["parent_id"] in sec_ids and s["section_id"] not in sec_ids:
                        sec_ids.add(s["section_id"])
                        changed = True
        for b in self.blocks:
            if not b["text"]:
                continue
            if sec_ids is not None and b["section_id"] not in sec_ids:
                continue
            if "page" in loc and b["page"] != loc["page"]:
                continue
            if "block_type" in loc and b["type"] != loc["block_type"]:
                continue
            out.append((self.units[b["block_id"]], {"kind": "block", "id": b["block_id"], "scope": "document", "section_id": b["section_id"]}))
        return out

    def resolve_anchor(self, spec: dict, owner: str) -> dict | None:
        quote = ws_norm(spec["quote"])
        hits = []
        loc = spec.get("in") or ({"unit": spec["unit"]} if spec.get("unit") else {})
        for unit, meta in self._targets(loc):
            normed, idx = [], []
            prev_space = False
            for i, ch in enumerate(unit.text):
                if ch.isspace():
                    if not prev_space and normed:
                        normed.append(" ")
                        idx.append(i)
                    prev_space = True
                else:
                    normed.append(ch)
                    idx.append(i)
                    prev_space = False
            ntext = "".join(normed)
            start = 0
            while True:
                j = ntext.find(quote, start)
                if j < 0:
                    break
                hits.append((unit, meta, idx[j], idx[j + len(quote) - 1] + 1))
                start = j + 1
        if len(hits) != 1:
            self.errors.append(f"{owner}: quote resolved to {len(hits)} locations ({spec.get('in')}): {quote[:90]!r}")
            return None
        unit, meta, s, e = hits[0]
        exact = unit.text[s:e]
        boxes = {}
        for (ws, we, b, pg) in unit.word_spans:
            if ws < e and we > s:
                boxes.setdefault(pg, []).append(b)
        # split per line for tighter highlights
        bxs = []
        for (ws, we, b, pg) in unit.word_spans:
            if ws < e and we > s:
                if bxs and bxs[-1]["page"] == pg and abs(bxs[-1]["top"] - b[1]) < 3:
                    bx = bxs[-1]
                    bx["x0"], bx["x1"] = min(bx["x0"], b[0]), max(bx["x1"], b[2])
                    bx["top"], bx["bottom"] = min(bx["top"], b[1]), max(bx["bottom"], b[3])
                else:
                    bxs.append({"page": pg, "x0": b[0], "top": b[1], "x1": b[2], "bottom": b[3]})
        for bx in bxs:
            for k in ("x0", "top", "x1", "bottom"):
                bx[k] = round(bx[k], 1)
        block = next((b for b in self.blocks if b["block_id"] == unit.id), None)
        text_layer = block["text_layer"] if block else "native"
        pages = sorted(boxes)
        anchor = {
            "anchor_id": "ANC-" + sha(f"{owner}|{meta['id']}|{s}|{e}", 10),
            "role": spec.get("role", "primary"),
            "target": {k: meta[k] for k in ("kind", "id", "table_id", "row_id", "row_label", "col_ids") if k in meta},
            "page": pages[0] if pages else unit.page, "pages": pages,
            "section_id": meta["section_id"], "exact_quote": exact, "char_start": s, "char_end": e,
            "bboxes": bxs, "text_layer": text_layer, "scope": meta["scope"],
        }
        if text_layer.startswith("ocr"):
            confs = [c for l in unit.lines for (a, b, c) in l.get("ocr_words", []) if a < e and b > s]
            anchor["ocr_min_conf"] = min(confs) if confs else None
        if spec.get("value"):
            v = spec["value"]
            j = exact.lower().find(v.lower())
            if j >= 0:
                anchor["value_span"] = [j, j + len(v)]
        if spec.get("note"):
            anchor["note"] = spec["note"]
        return anchor

    def absence_check(self, terms: list[str]) -> dict:
        hits = []
        for uid, unit in self.units.items():
            for t in terms:
                for m in re.finditer(rf"\b{re.escape(t)}", unit.text, re.I):
                    ctx = unit.text[max(0, m.start() - 50): m.end() + 50]
                    hits.append({"term": t, "target_id": uid, "page": unit.page, "scope": unit.scope, "context": ws_norm(ctx)})
        return {"terms": terms, "searched": "all v2 blocks, table cells and OCR text for this clearance (word-prefix, case-insensitive)",
                "hit_count": len(hits), "subject_hit_count": sum(1 for h in hits if h["scope"] in ("document", "subject", "shared", "comment")),
                "hits": hits[:25]}

    # ---------------------------------------------------------------- claims

    @staticmethod
    def fingerprint(obj: dict) -> str:
        ev = sorted((ws_norm(a["exact_quote"]), tuple(a["pages"]), a["scope"], a["role"]) for a in obj.get("evidence", []))
        core = [obj.get("value_state", ""), obj.get("polarity", ""), obj.get("normalized_value", ""), obj.get("category", ""), obj.get("relation", ""), obj.get("basis", ""), ev]
        return sha(json.dumps(core, ensure_ascii=False), 16)

    def build_claims(self):
        cur = self.curation
        legacy_claims = {c["claim_id"]: c for c in self.legacy["claims"]}
        v1_reviews = {}
        if self.args.v1_packet:
            for c in json.loads(Path(self.args.v1_packet).read_text())["claims"]:
                if c["k_number"] == self.k:
                    v1_reviews[c["claim_id"]] = c
        v2_reviews = {}
        if self.args.v2_packet and Path(self.args.v2_packet).exists():
            pkt = json.loads(Path(self.args.v2_packet).read_text())
            for r in pkt.get("claims", []) + pkt.get("relationships", []):
                v2_reviews[r.get("claim_id") or r.get("relationship_id")] = r
        review_keys = ("review_decision", "reviewed_value", "reviewer_date", "reviewer_notes")
        doc = self.legacy["document"]
        section_title = {s["section_id"]: s["title"] for s in self.sections}

        claims, ref_to_id = [], {}
        # 1) legacy claims, verbatim + assessment + re-anchored evidence
        assessments = {a["claim_id"]: a for a in (cur or {}).get("legacy_assessments", [])}
        for cid, c in legacy_claims.items():
            out = dict(c)
            for k in review_keys:
                if cid in v1_reviews:
                    out[k] = v1_reviews[cid].get(k, out.get(k, ""))
            a = assessments.get(cid)
            ev = [x for x in (self.resolve_anchor(e, cid) for e in (a or {}).get("evidence", [])) if x]
            out.update({
                "origin": "v1-extraction", "curation_ref": (a or {}).get("ref", ""),
                "category": (a or {}).get("category", ""), "aggregate": (a or {}).get("aggregate", True),
                "value_state": (a or {}).get("value_state", "stated"), "polarity": (a or {}).get("polarity", "affirmed"),
                "interpretation_v2": (a or {}).get("interpretation", ""), "interpretation_note": (a or {}).get("note", ""),
                "subject_scope": self._scope_of(ev), "evidence": ev,
                "legacy_assessment": {k: a[k] for k in ("verdict", "recommended_action", "note", "superseded_by", "suggested_reviewed_value") if k in a} if a else
                                     {"verdict": "not assessed", "recommended_action": "review", "note": "No prototype curation for this claim."},
            })
            if a and a.get("aggregate_note"):
                out["aggregate_note"] = a["aggregate_note"]
            if a and a.get("ref"):
                ref_to_id[a["ref"]] = cid
            claims.append(out)
        # 2) new curated claims
        for p in (cur or {}).get("claims", []):
            cid = p.get("claim_id") or "CLM-" + sha(f"v2|{self.k}|{p['field']}|{p['ref']}")
            if cid in legacy_claims:
                self.errors.append(f"new claim {p['ref']} collides with legacy claim {cid}")
                continue
            ref_to_id[p["ref"]] = cid
            ev = [x for x in (self.resolve_anchor(e, cid) for e in p.get("evidence", [])) if x]
            primary = next((a for a in ev if a["role"] == "primary"), ev[0] if ev else None)
            state = p.get("value_state", "stated")
            src = p.get("source_value", "")
            match = "n/a" if state != "stated" else ("pass" if primary and src and src.lower() in ws_norm(primary["exact_quote"]).lower() else "partial" if primary else "fail")
            out = {
                "claim_id": cid, "k_number": self.k, "family_id": doc["family_id"], "family_name": doc["family_name"],
                "field": p["field"], "source_value": src, "normalized_value": p.get("normalized_value", state if state != "stated" else ""),
                "page": primary["page"] if primary else None, "section": section_title.get(primary["section_id"], "") if primary else "",
                "block_id": primary["target"]["id"] if primary else "", "supporting_excerpt": primary["exact_quote"] if primary else "",
                "surrounding_context": "", "evidence_text_match": match, "interpretation_status": p["interpretation"],
                "model_confidence": "", "source_layer": "FDA 510(k)", "source_sha256": doc["sha256"],
                "review_decision": "pending", "reviewed_value": "", "reviewer_date": "", "reviewer_notes": "",
                "origin": "prototype-curation", "curation_ref": p["ref"], "value_state": state,
                "category": p.get("category", ""), "aggregate": p.get("aggregate", True),
                "polarity": p.get("polarity", "affirmed"), "interpretation_v2": p["interpretation"],
                "interpretation_note": p.get("note", ""), "subject_scope": self._scope_of(ev), "evidence": ev,
            }
            if p.get("absence_terms"):
                out["absence_check"] = self.absence_check(p["absence_terms"])
            if p.get("aggregate_note"):
                out["aggregate_note"] = p["aggregate_note"]
            if p.get("machine_review"):
                out["machine_review"] = p["machine_review"]
            claims.append(out)
        for c in claims:
            c["evidence_fingerprint"] = self.fingerprint(c)
            r = v2_reviews.get(c["claim_id"])
            if r:
                for k in review_keys + ("reviewer", "reviewed_category", "reviewed_evidence_fingerprint"):
                    if k in r:
                        c[k] = r[k]
            c.setdefault("reviewer", "")
            c.setdefault("reviewed_category", "")
            c.setdefault("reviewed_evidence_fingerprint", "")
            self._validate_claim(c)

        # 3) chains
        chains = []
        for ch in (cur or {}).get("chains", []):
            slots = {}
            for f in CHAIN_FIELDS + SUPPLEMENTARY_FIELDS:
                ids = [ref_to_id[r] for r in ch.get("slots", {}).get(f, []) if r in ref_to_id]
                missing = [r for r in ch.get("slots", {}).get(f, []) if r not in ref_to_id]
                for m in missing:
                    self.errors.append(f"chain {ch['chain_id']} references unknown claim ref {m}")
                states = [next(c for c in claims if c["claim_id"] == i)["value_state"] for i in ids]
                state = "stated" if "stated" in states else (states[0] if states else "")
                slots[f] = {"state": state, "claim_ids": ids}
            chains.append({"chain_id": ch["chain_id"], "kind": ch.get("kind", "measurement"), "label": ch["label"],
                           "summary": ch.get("summary", ""), "slots": slots, "caveats": ch.get("caveats", [])})

        # 4) relationships
        rels = []
        for r in (cur or {}).get("relationships", []):
            if r["relation"] not in RELATIONS or r["basis"] not in BASES:
                self.errors.append(f"relationship {r} uses unknown relation/basis")
                continue
            if r["from"] not in ref_to_id or r["to"] not in ref_to_id:
                self.errors.append(f"relationship {r['from']}→{r['to']} references unknown claim ref")
                continue
            rid = "REL-" + sha(f"v2|{self.k}|{r['chain']}|{r['from']}|{r['relation']}|{r['to']}")
            ev = [x for x in (self.resolve_anchor(e, rid) for e in r.get("evidence", [])) if x]
            rel = {"relationship_id": rid, "k_number": self.k, "chain_id": r["chain"], "from_claim_id": ref_to_id[r["from"]],
                   "to_claim_id": ref_to_id[r["to"]], "relation": r["relation"], "basis": r["basis"], "note": r.get("note", ""),
                   "evidence": ev, "review_decision": "pending", "reviewed_value": "", "reviewer_date": "", "reviewer_notes": "",
                   "reviewer": "", "reviewed_evidence_fingerprint": ""}
            if r.get("ref"):
                rel["curation_ref"] = r["ref"]
            if r.get("machine_review"):
                rel["machine_review"] = r["machine_review"]
            rel["evidence_fingerprint"] = self.fingerprint(rel)
            prev = v2_reviews.get(rid)
            if prev:
                for k in review_keys + ("reviewer", "reviewed_evidence_fingerprint"):
                    if k in prev:
                        rel[k] = prev[k]
            if r["basis"] not in ("not-stated", "inferred") and not ev:
                self.errors.append(f"relationship {rid} has basis {r['basis']} but no evidence")
            rels.append(rel)
        return claims, chains, rels

    @staticmethod
    def _scope_of(ev: list[dict]) -> str:
        prim = [a["scope"] for a in ev if a["role"] == "primary"] or [a["scope"] for a in ev]
        if not prim:
            return ""
        if "subject" in prim or "document" in prim:
            return "subject"
        if "shared" in prim:
            return "shared"
        if "comment" in prim:
            return "comment"
        return prim[0]

    def _validate_claim(self, c):
        if c["value_state"] not in VALUE_STATES:
            self.errors.append(f"{c['claim_id']}: bad value_state {c['value_state']}")
        if c["origin"] == "prototype-curation":
            if c["interpretation_v2"] not in INTERPRETATIONS_V2:
                self.errors.append(f"{c['claim_id']}: bad interpretation {c['interpretation_v2']}")
            if c["value_state"] == "stated" and not any(a["role"] == "primary" for a in c["evidence"]):
                self.errors.append(f"{c['claim_id']}: stated claim without primary evidence")
            if c["value_state"] == "stated" and c["subject_scope"] == "predicate":
                self.errors.append(f"{c['claim_id']}: subject claim supported only by a predicate column")

    # ---------------------------------------------------------------- renders

    def render_pages(self, out_dir: Path, dpi: int):
        target = out_dir / "pages" / self.k
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(["pdftoppm", "-r", str(dpi), "-png", str(self.pdf_path), str(target / "p")], check=True)
        for p in sorted(target.glob("p-*.png")):
            n = int(p.stem.split("-")[1])
            p.rename(target / f"p-{n:02d}.png")
        for pg in self.pages:
            pg["render_dpi"] = dpi

    # ---------------------------------------------------------------- output

    def output(self, claims, chains, rels):
        for t in self.tables:
            t.pop("_bounds", None)
            t.pop("_header_sig", None)
            t.pop("_header_rows", None)
        return {
            "schema_version": "2.0-prototype",
            "document": self.legacy["document"],
            "build": {
                "builder": "pipeline/build_document_v2.py", "builder_version": BUILDER_VERSION,
                "built_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "inputs": {"pdf_sha256": file_sha256(self.pdf_path), "legacy_json_sha256": file_sha256(Path(self.args.legacy)),
                           "curation_sha256": file_sha256(Path(self.args.curation)) if self.args.curation else ""},
                "pdfplumber_version": pdfplumber.__version__,
                "text_layers": sorted({p["text_layer"] for p in self.pages}),
                "curation": {k: self.curation[k] for k in ("curator", "curated_on", "status", "scope_note") if k in self.curation} if self.curation else None,
            },
            "legacy": {"pages": self.legacy["pages"], "blocks": self.legacy["blocks"]},
            "pages": self.pages, "parts": self.parts, "sections": self.sections, "artifacts": self.artifacts,
            "blocks": self.blocks, "tables": self.tables, "claims": claims, "chains": chains, "relationships": rels,
        }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--legacy", required=True)
    ap.add_argument("--v1-packet")
    ap.add_argument("--v2-packet")
    ap.add_argument("--curation")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--dpi", type=int, default=110)
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--validate-only", action="store_true", help="resolve and check the curation; write nothing")
    ap.add_argument("--dump-text", help="write resolved text units to this path (curation aid)")
    args = ap.parse_args()

    b = Builder(args)
    if file_sha256(b.pdf_path) != b.legacy["document"]["sha256"]:
        sys.exit(f"PDF checksum does not match the v1 record for {b.k}")
    b.run_structure()
    b.map_legacy_blocks()
    if args.dump_text:
        Path(args.dump_text).write_text(b.dump_units())
    claims, chains, rels = b.build_claims()
    if b.errors:
        print("\n".join(b.errors), file=sys.stderr)
        sys.exit(f"{len(b.errors)} curation/anchor error(s); nothing written")
    if args.validate_only:
        print(json.dumps({"valid": True, "claims": len(claims), "new_claims": sum(c["origin"] == "prototype-curation" for c in claims),
                          "chains": len(chains), "relationships": len(rels)}))
        return
    out_dir = Path(args.out_dir)
    if not args.no_render:
        b.render_pages(out_dir, args.dpi)
    (out_dir / "documents").mkdir(parents=True, exist_ok=True)
    payload = b.output(claims, chains, rels)
    (out_dir / "documents" / f"{b.k}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({"k_number": b.k, "pages": len(b.pages), "blocks": len(b.blocks), "tables": len(b.tables),
                      "table_rows": sum(len(t["rows"]) for t in b.tables), "artifacts": len(b.artifacts),
                      "sections": len(b.sections), "claims": len(claims), "chains": len(chains), "relationships": len(rels)}))


if __name__ == "__main__":
    main()
