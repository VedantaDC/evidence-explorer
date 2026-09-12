import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "/Users/ps/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const root=new URL("../",import.meta.url);
const workbookPath=process.argv.find(x=>x.endsWith(".xlsx"))||fileURLToPath(new URL("public/510k_Evidence_Review.xlsx",root));
const checkOnly=process.argv.includes("--check-only");
const canonicalPath=new URL("public/evidence_data/review_packet.json",root);
const canonical=JSON.parse(await fs.readFile(canonicalPath,"utf8"));
const allowed=new Set(canonical.allowed_review_decisions);
const byId=new Map(canonical.claims.map(c=>[c.claim_id,c]));
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheet=workbook.worksheets.getItem("Review Queue");
const values=sheet.getUsedRange(true).values;
let updated=0;
for(const row of values.slice(3)){
  const id=String(row[0]||""); if(!id)continue;
  if(!byId.has(id))throw new Error(`Unknown claim ID: ${id}`);
  const decision=String(row[12]||"pending");
  if(!allowed.has(decision))throw new Error(`Invalid review decision for ${id}: ${decision}`);
  const claim=byId.get(id);
  for(const [key,value] of [["review_decision",decision],["reviewed_value",String(row[13]||"")],["reviewer_date",String(row[14]||"")],["reviewer_notes",String(row[15]||"")]]){if(claim[key]!==value){claim[key]=value;updated++}}
}
if(values.length-3!==canonical.claims.length)throw new Error(`Claim row mismatch: workbook=${values.length-3}, canonical=${canonical.claims.length}`);
if(!checkOnly){canonical.imported_at_utc=new Date().toISOString();canonical.imported_from=workbookPath;await fs.writeFile(canonicalPath,JSON.stringify(canonical,null,2)+"\n")}
console.log(JSON.stringify({valid:true,claims:canonical.claims.length,updated_fields:updated,check_only:checkOnly}));
