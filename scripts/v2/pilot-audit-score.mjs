// Score a completed audit sample: accuracy per stratum with 95% Wilson intervals.
// Usage: node scripts/v2/pilot-audit-score.mjs <audit_sample.xlsx>
import ExcelJS from "exceljs";

const file = process.argv[2];
if (!file) { console.error("usage: pilot-audit-score.mjs <audit_sample.xlsx>"); process.exit(2); }
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet("Audit sample");
const col = {};
ws.getRow(1).eachCell((c, i) => { col[c.text] = i; });
const V = col["YOUR VERDICT (correct / incorrect / unsure)"], S = col["Stratum"], M = col["Machine status"];
const wilson = (k, n) => {
  if (!n) return [null, null];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d].map((x) => Math.round(x * 1000) / 10);
};
const tally = {};
ws.eachRow((r, i) => {
  if (i === 1) return;
  const v = r.getCell(V).text.trim().toLowerCase();
  if (!v) return;
  // for verifier-rejected items, "correct" means the rejection was right (the fact was indeed unsupported)
  const key = r.getCell(S).text;
  const t = (tally[key] ||= { correct: 0, incorrect: 0, unsure: 0, machine_status: r.getCell(M).text });
  if (v in t) t[v]++;
});
const rows = Object.entries(tally).map(([stratum, t]) => {
  const n = t.correct + t.incorrect;
  return { stratum, n, correct: t.correct, incorrect: t.incorrect, unsure: t.unsure, accuracy_pct: n ? Math.round(1000 * t.correct / n) / 10 : null, ci95: wilson(t.correct, n) };
});
const accepted = rows.filter((r) => r.stratum !== "rejected-by-verifier");
const k = accepted.reduce((a, r) => a + r.correct, 0), n = accepted.reduce((a, r) => a + r.n, 0);
console.log(JSON.stringify({ per_stratum: rows, machine_verified_overall: { n, correct: k, accuracy_pct: n ? Math.round(1000 * k / n) / 10 : null, ci95: wilson(k, n) },
  note: "Stratified sample: the overall figure is unweighted across strata. 'Unsure' is excluded from n and reported separately." }, null, 1));
