import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "/Users/ps/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const root=new URL("../",import.meta.url);
const index=JSON.parse(await fs.readFile(new URL("public/evidence_data/index.json",root),"utf8"));
const packet=JSON.parse(await fs.readFile(new URL("public/evidence_data/review_packet.json",root),"utf8"));
const codebook=JSON.parse(await fs.readFile(new URL("public/evidence_data/codebook.json",root),"utf8"));
const docs=new Map(index.documents.map(d=>[d.k_number,d]));
const wb=Workbook.create();
const navy="#173F5E",teal="#0B8582",pale="#E8F4F3",line="#D9E2E5",amber="#FFF0C9";

function addSheet(name,headers,rows,widths,tableName){
  rows=rows.map(row=>row.map(value=>typeof value==="string"?value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,""):value));
  const sh=wb.worksheets.add(name); sh.showGridLines=false;
  sh.getRange("A1").values=[[name]]; sh.getRange("A1").format.font={bold:true,size:14,color:navy};
  sh.getRange(`A3:${col(headers.length)}3`).values=[headers];
  if(rows.length)sh.getRange(`A4:${col(headers.length)}${rows.length+3}`).values=rows;
  const used=sh.getRange(`A3:${col(headers.length)}${Math.max(3,rows.length+3)}`);
  used.format.font={name:"Arial",size:10,color:"#243B47"}; used.format.verticalAlignment="top";
  sh.getRange(`A3:${col(headers.length)}3`).format={fill:navy,font:{bold:true,color:"#FFFFFF",size:10},horizontalAlignment:"center",verticalAlignment:"center",wrapText:true,borders:{preset:"inside",style:"thin",color:"#FFFFFF"}};
  if(rows.length){used.format.wrapText=true;const table=sh.tables.add(`A3:${col(headers.length)}${rows.length+3}`,true,tableName);table.style="TableStyleMedium2";table.showFilterButton=true;}
  widths.forEach((w,i)=>sh.getRange(`${col(i+1)}:${col(i+1)}`).format.columnWidth=w);
  sh.getRange("1:1").format.rowHeight=24; sh.getRange("3:3").format.rowHeight=30;
  sh.freezePanes.freezeRows(3); sh.freezePanes.freezeColumns(Math.min(2,headers.length));
  return sh;
}
function col(n){let s="";while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function siteUrl(k,claim=""){return `https://vedantadc.github.io/evidence-explorer/510k/${k}/${claim?`#claim-${claim}`:""}`}

const reviewHeaders=["Claim ID","510(k)","Product code","Device","Field","Proposed normalized value","Exact FDA excerpt","Page","Section","Block ID","Interpretation","Text match","Review decision","Reviewed value","Reviewer date","Reviewer notes","Evidence page"];
const reviewRows=packet.claims.map(c=>{const d=docs.get(c.k_number)||{};return[c.claim_id,c.k_number,d.product_code||"",d.device_name||"",c.field,c.normalized_value,c.supporting_excerpt,c.page,c.section,c.block_id,c.interpretation_status,c.evidence_text_match,c.review_decision,c.reviewed_value,c.reviewer_date,c.reviewer_notes,siteUrl(c.k_number,c.claim_id)]});
const review=addSheet("Review Queue",reviewHeaders,reviewRows,[20,11,11,28,25,30,70,8,24,22,20,12,22,30,14,38,16],"ReviewQueueTable");
review.getRange(`M4:M${reviewRows.length+3}`).dataValidation={rule:{type:"list",values:packet.allowed_review_decisions}};
review.getRange(`M4:P${reviewRows.length+3}`).format.fill=amber;

const documentHeaders=["510(k)","Product code","Device name","Applicant","Decision date","Document type","Source status","Pages","Native pages","OCR pages","SHA-256","Family ID","Family name","Pilot","Claim count","Pending claims","Review status","FDA source","Evidence page"];
const documentRows=index.documents.map(d=>[d.k_number,d.product_code,d.device_name,d.applicant,d.decision_date,d.document_type,d.source_status,d.page_count,d.native_pages,d.ocr_pages,d.sha256,d.family_id,d.family_name,d.pilot,d.claim_count,d.pending_claim_count,d.review_status,d.source_url,siteUrl(d.k_number)]);
const documents=addSheet("Documents",documentHeaders,documentRows,[11,11,32,28,13,16,14,9,11,9,42,20,28,8,11,13,18,44,16],"DocumentsTable");

const claimHeaders=["Claim ID","510(k)","Family ID","Family name","Field","Source wording","Normalized value","Interpretation status","Source layer","Source checksum"];
addSheet("Claims",claimHeaders,packet.claims.map(c=>[c.claim_id,c.k_number,c.family_id,c.family_name,c.field,c.source_value,c.normalized_value,c.interpretation_status,c.source_layer,c.source_sha256]),[20,11,20,28,25,35,35,22,15,42],"ClaimsTable");

const evidenceHeaders=["Claim ID","510(k)","Exact supporting excerpt","Page","Section","Block ID","Surrounding context","Extraction / text match","Evidence page"];
const evidenceRows=packet.claims.map(c=>[c.claim_id,c.k_number,c.supporting_excerpt,c.page,c.section,c.block_id,c.surrounding_context,c.evidence_text_match,siteUrl(c.k_number,c.claim_id)]);
const evidence=addSheet("Evidence",evidenceHeaders,evidenceRows,[20,11,70,8,25,22,75,20,16],"EvidenceTable");

const codeRows=[
  ["Measurement chain",codebook.measurement_chain.join(" → ")],
  ...Object.entries(codebook.review_decisions).map(([k,v])=>[`Review: ${k}`,v]),
  ...Object.entries(codebook.missing_values).map(([k,v])=>[`Missing value: ${k}`,v]),
  ["Aggregation rule",codebook.aggregation_rule],
  ["Evidence rule","Every populated technical field must carry field-specific FDA evidence. A passage discussing multiple layers does not merge those layers into one claim."],
  ["Authority","The original FDA PDF is the ultimate regulatory source. HTML and workbook content are unofficial research derivatives."],
];
addSheet("Codebook",["Term / rule","Definition"],codeRows,[34,110],"CodebookTable");

const s=index.stats;
const auditRows=[
  ["Snapshot date",String(s.generated_at_utc).slice(0,10),"Refreshed FDA inventory"],
  ["Inventory records",s.inventory_records,"Must equal document rows"],["Available documents",s.available_documents,"HTML transcript pages created"],["Unavailable documents",s.unavailable_documents,"Stubs retained in retrieval queue"],["Source pages",s.pages,"Native + OCR source pages"],["Native pages",s.native_pages,"Embedded text extraction"],["Locally OCRed pages",s.ocr_pages,"Cloud comparison not run without credentials"],["Atomic candidate claims",s.claims,"Unique stable claim IDs"],["Verified claims",s.verified_claims,"Only these can aggregate"],["Needs clarification",s.needs_clarification,"Cannot aggregate"],["Pilot documents",s.pilot_documents,"8 MNR · 7 OLV · 5 OLZ"],
  ["Prohibited inference","SpO2 ≠ accessible PPG waveform","Must be explicitly documented"],["Prohibited inference","Airflow ≠ pressure transducer","Must be explicitly documented"],["Prohibited inference","Effort belt ≠ calibrated quantitative effort","Must be explicitly documented"],["Prohibited inference","Apnea/hypopnea detection ≠ AHI","Must be explicitly documented"],["Prohibited inference","Named sensor ≠ anatomical location","Must be explicitly documented"],["Prohibited inference","Recorded waveform ≠ reported output","Must be explicitly documented"],
];
const audit=addSheet("Audit",["Check / metric","Value","Rule / result"],auditRows,[34,34,80],"AuditTable");
audit.getRange("A4:C14").format.fill=pale;

await wb.recalculate();
const inspection=await wb.inspect({kind:"sheet,table",maxChars:6000,tableMaxRows:4,tableMaxCols:6,tableMaxCellChars:60});
console.log(inspection.ndjson);
const out=await SpreadsheetFile.exportXlsx(wb);
await out.save(fileURLToPath(new URL("public/510k_Evidence_Review.xlsx",root)));
const previewRanges={"Review Queue":"A1:Q12",Documents:"A1:S14",Claims:"A1:J14",Evidence:"A1:I14",Codebook:"A1:B15",Audit:"A1:C20"};
for(const name of Object.keys(previewRanges)){const image=await wb.render({sheetName:name,range:previewRanges[name],autoCrop:"all",scale:.75,format:"png"});await fs.mkdir(new URL("tmp/workbook-previews/",root),{recursive:true});await fs.writeFile(new URL(`tmp/workbook-previews/${name.replaceAll(" ","_")}.png`,root),new Uint8Array(await image.arrayBuffer()))}
console.log(JSON.stringify({output:fileURLToPath(new URL("public/510k_Evidence_Review.xlsx",root)),rows:reviewRows.length,sheets:6}));
