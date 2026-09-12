import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const publicRoot=new URL("../public/",import.meta.url);

test("reconciles the refreshed FDA corpus and pilot",async()=>{
  const index=JSON.parse(await readFile(new URL("evidence_data/index.json",publicRoot),"utf8"));
  assert.equal(index.stats.inventory_records,266);
  assert.equal(index.stats.available_documents,234);
  assert.equal(index.stats.unavailable_documents,32);
  assert.equal(index.stats.pages,2026);
  assert.equal(index.stats.pilot_documents,20);
  assert.deepEqual(index.stats.product_codes,{MNR:164,OLV:65,OLZ:37});
  assert.equal(index.documents.length,266);
  assert.equal(index.documents.filter(d=>d.source_status==="available").reduce((n,d)=>n+d.page_count,0),2026);
});

test("keeps evidence excerpts literal, claim IDs unique, and verified aggregation gated",async()=>{
  const index=JSON.parse(await readFile(new URL("evidence_data/index.json",publicRoot),"utf8"));
  const packet=JSON.parse(await readFile(new URL("evidence_data/review_packet.json",publicRoot),"utf8"));
  assert.equal(new Set(packet.claims.map(c=>c.claim_id)).size,packet.claims.length);
  assert.equal(index.table83.length,0,"no pending claim may enter verified Table 8.3");
  for(const d of index.documents){
    const payload=JSON.parse(await readFile(new URL(`evidence_data/documents/${d.k_number}.json`,publicRoot),"utf8"));
    assert.equal(payload.pages.length,d.source_status==="available"?d.page_count:0);
    const blocks=new Map(payload.blocks.map(b=>[b.block_id,b.text]));
    for(const c of payload.claims)if(c.supporting_excerpt)assert.ok((blocks.get(c.block_id)||"").includes(c.supporting_excerpt),c.claim_id);
  }
});

test("ships every direct clearance route and portable review artifacts",async()=>{
  const index=JSON.parse(await readFile(new URL("evidence_data/index.json",publicRoot),"utf8"));
  await Promise.all(index.documents.map(d=>access(new URL(`../pages-dist/510k/${d.k_number}/index.html`,import.meta.url))));
  await access(new URL("../pages-dist/evidence/index.html",import.meta.url));
  const workbook=await readFile(new URL("510k_Evidence_Review.xlsx",publicRoot));
  assert.ok(workbook.byteLength>1_000_000);
});

test("codifies prohibited physiological inferences",async()=>{
  const audit=await readFile(new URL("../scripts/build-review-workbook.mjs",import.meta.url),"utf8");
  for(const rule of ["SpO2 ≠ accessible PPG waveform","Airflow ≠ pressure transducer","Effort belt ≠ calibrated quantitative effort","Apnea/hypopnea detection ≠ AHI","Named sensor ≠ anatomical location","Recorded waveform ≠ reported output"])assert.match(audit,new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
