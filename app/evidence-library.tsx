"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DocumentRow = {
  k_number:string; corpus:string; product_code:string; device_name:string; applicant:string;
  decision_date:string; document_type:string; source_status:string; download_status:string;
  source_url:string; fda_detail_url:string; sha256:string; page_count:number; native_pages:number;
  ocr_pages:number; family_id:string; family_name:string; retrieval_snapshot:string;
  rights_review:string; claim_count:number; pending_claim_count:number; review_status:string; pilot:boolean;
};
type Claim = {
  claim_id:string; k_number:string; field:string; source_value:string; normalized_value:string;
  page:number; section:string; block_id:string; supporting_excerpt:string; surrounding_context:string;
  evidence_text_match:string; interpretation_status:string; model_confidence:string; source_layer:string;
  review_decision:string; reviewed_value:string; reviewer_date:string; reviewer_notes:string;
};
type Block = {block_id:string; page:number; ordinal:number; type:string; section:string; text:string; extraction_method:string};
type EvidenceIndex = {stats:Record<string,any>; documents:DocumentRow[]; table83:any[]};
type EvidenceDocument = {document:DocumentRow; pages:any[]; blocks:Block[]; claims:Claim[]};
type Draft = Pick<Claim,"review_decision"|"reviewed_value"|"reviewer_date"|"reviewer_notes">;

const decisionOptions=["pending","verified","edited and verified","rejected","needs clarification"];
const fieldLabels:Record<string,string>={
  indications_for_use:"Indications for use",intended_use_role:"Intended-use terminology",
  sensor_technology:"Physical sensor technology",sensor_location:"Sensor location",
  raw_acquired_signal:"Raw / acquired signal",physiological_parameter:"Physiological parameter",
  direct_vs_derived:"Directly sensed or derived",derived_reported_feature:"Derived / reported physiological feature",
  diagnostic_output:"Diagnostic output",
};

function basePath(){return typeof window!=="undefined"&&window.location.pathname.startsWith("/evidence-explorer")?"/evidence-explorer/":"/"}
function asset(path:string){return `${basePath()}${path.replace(/^\//,"")}`}
function kFromPath(){if(typeof window==="undefined")return "";return window.location.pathname.match(/\/510k\/(K\d+)/i)?.[1]?.toUpperCase()||""}
function today(){return new Date().toISOString().slice(0,10)}
function downloadJson(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}

export function EvidenceLibrary({onExit}:{onExit?:()=>void}){
  const routeK=kFromPath();
  if(routeK)return <EvidenceDetail kNumber={routeK}/>;
  return <EvidenceIndexView onExit={onExit}/>;
}

function EvidenceIndexView({onExit}:{onExit?:()=>void}){
  const [data,setData]=useState<EvidenceIndex|null>(null);
  const [query,setQuery]=useState(""); const [code,setCode]=useState(""); const [availability,setAvailability]=useState(""); const [pilot,setPilot]=useState(false);
  useEffect(()=>{fetch(asset("evidence_data/index.json")).then(r=>r.json()).then(setData)},[]);
  const rows=useMemo(()=>data?.documents.filter(d=>(!query||`${d.k_number} ${d.device_name} ${d.applicant} ${d.family_name}`.toLowerCase().includes(query.toLowerCase()))&&(!code||d.product_code===code)&&(!availability||d.source_status===availability)&&(!pilot||d.pilot))||[],[data,query,code,availability,pilot]);
  if(!data)return <main className="evidenceShell loading"><div className="loadingMark"/><h1>Opening the evidence library…</h1></main>;
  const s=data.stats;
  return <main className="evidenceShell">
    <header className="evidenceTop"><button onClick={onExit} className="backButton">← Evidence Explorer</button><div><span>PUBLICATION-GRADE SOURCE LAYER</span><h1>510(k) Evidence Library</h1><p>Clearance-level FDA documents, exact excerpts, and portable human review.</p></div></header>
    <section className="evidenceMetrics"><Metric value={s.inventory_records} label="clearance records"/><Metric value={s.available_documents} label="FDA documents"/><Metric value={s.pages} label="source pages"/><Metric value={s.unavailable_documents} label="retrieval queue"/><Metric value={s.verified_claims} label="verified claims"/></section>
    <section className="evidenceNotice"><strong>Verification boundary</strong><span>{s.claims.toLocaleString()} candidate claims are visible for review. Only verified or edited-and-verified claims can enter the publication Table 8.3; the verified table currently contains {data.table83.length} rows. Pilot gate: {s.pilot_gate_status}.</span></section>
    <div className="libraryActions"><a href={asset("510k_Evidence_Review.xlsx")} download>Download review workbook</a><a href={asset("evidence_data/review_packet.json")} download>Download review JSON</a><a href={asset("evidence_data/retrieval_queue.csv")} download>Missing-document queue</a></div>
    <section className="libraryFilters"><label><span>Search</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="K number, device, applicant, or family"/></label><label><span>Product code</span><select value={code} onChange={e=>setCode(e.target.value)}><option value="">All</option>{["MNR","OLV","OLZ"].map(x=><option key={x}>{x}</option>)}</select></label><label><span>Source status</span><select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="">All</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select></label><label className="pilotCheck"><input type="checkbox" checked={pilot} onChange={e=>setPilot(e.target.checked)}/><span>20-document pilot only</span></label><button onClick={()=>{setQuery("");setCode("");setAvailability("");setPilot(false)}}>Clear</button></section>
    <div className="libraryCount">Showing <strong>{rows.length}</strong> of {s.inventory_records} clearance records</div>
    <div className="tableWrap evidenceIndexTable"><table><thead><tr><th>510(k)</th><th>Device</th><th>Product code</th><th>Date</th><th>FDA source</th><th>Extraction</th><th>Review</th></tr></thead><tbody>{rows.map(d=><tr key={d.k_number}><td><a className="kRoute" href={asset(`510k/${d.k_number}/`)}>{d.k_number}</a>{d.pilot&&<small className="pilotPill">Pilot</small>}</td><td><strong>{d.device_name}</strong><small>{d.applicant}</small>{d.family_name&&<small>{d.family_name}</small>}</td><td>{d.product_code}</td><td>{d.decision_date||"Not stated"}</td><td><span className={`sourceState ${d.source_status}`}>{d.source_status}</span><small>{d.document_type}</small></td><td>{d.source_status==="available"?<><strong>{d.page_count} pages</strong><small>{d.ocr_pages?`${d.ocr_pages} OCR · `:""}{d.native_pages} native</small></>:<span>Retrieval pending</span>}</td><td><strong>{d.claim_count} claims</strong><small>{d.pending_claim_count} pending</small></td></tr>)}</tbody></table></div>
    <footer className="evidenceFooter">Unofficial research transcription · FDA remains the ultimate regulatory source · Snapshot {s.generated_at_utc.slice(0,10)}</footer>
  </main>
}

function Metric({value,label}:{value:number;label:string}){return <article><strong>{value.toLocaleString()}</strong><span>{label}</span></article>}

export function EvidenceDetail({kNumber}:{kNumber:string}){
  const [data,setData]=useState<EvidenceDocument|null>(null); const [tab,setTab]=useState("document"); const [search,setSearch]=useState(""); const [drafts,setDrafts]=useState<Record<string,Draft>>({}); const [highlight,setHighlight]=useState(""); const importRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{fetch(asset(`evidence_data/documents/${kNumber}.json`)).then(r=>r.json()).then((value:EvidenceDocument)=>{setData(value);const saved=localStorage.getItem(`evidence-review-${kNumber}`);if(saved)try{setDrafts(JSON.parse(saved))}catch{}})},[kNumber]);
  useEffect(()=>{if(data)localStorage.setItem(`evidence-review-${kNumber}`,JSON.stringify(drafts))},[data,drafts,kNumber]);
  const update=(c:Claim,patch:Partial<Draft>)=>setDrafts(old=>({...old,[c.claim_id]:{review_decision:c.review_decision,reviewed_value:c.reviewed_value,reviewer_date:c.reviewer_date,reviewer_notes:c.reviewer_notes,...old[c.claim_id],...patch}}));
  const merged=(c:Claim)=>({...c,...drafts[c.claim_id]});
  const goEvidence=(c:Claim)=>{setTab("document");setHighlight(c.block_id);setTimeout(()=>document.getElementById(c.block_id)?.scrollIntoView({behavior:"smooth",block:"center"}),80)};
  const exportPacket=()=>{if(!data)return;downloadJson({schema_version:"1.0",document:kNumber,exported_at:new Date().toISOString(),claims:data.claims.map(merged)},`${kNumber}_review.json`)};
  const importPacket=async(file?:File)=>{if(!file||!data)return;const packet=JSON.parse(await file.text());const allowed=new Set(data.claims.map(c=>c.claim_id));const next:Record<string,Draft>={};for(const c of packet.claims||[]){if(allowed.has(c.claim_id)&&decisionOptions.includes(c.review_decision))next[c.claim_id]={review_decision:c.review_decision,reviewed_value:c.reviewed_value||"",reviewer_date:c.reviewer_date||"",reviewer_notes:c.reviewer_notes||""}}setDrafts(next)};
  if(!data)return <main className="evidenceShell loading"><div className="loadingMark"/><h1>Opening {kNumber}…</h1></main>;
  const d=data.document; const filteredBlocks=data.blocks.filter(b=>!search||b.text.toLowerCase().includes(search.toLowerCase())); const decisions=data.claims.map(c=>merged(c).review_decision); const reviewed=decisions.filter(x=>x!=="pending").length;
  return <main className="evidenceShell detailShell">
    <header className="detailHeader"><a href={asset("evidence/")}>← All clearances</a><div><span>{d.product_code} · {d.document_type} · {d.decision_date||"date not stated"}</span><h1>{d.k_number}: {d.device_name}</h1><p>{d.applicant}{d.family_name?` · ${d.family_name}`:""}</p></div><div className="sourceButtons">{d.source_url&&<a href={d.source_url} target="_blank" rel="noreferrer">Original FDA PDF ↗</a>}{d.fda_detail_url&&<a href={d.fda_detail_url} target="_blank" rel="noreferrer">FDA record ↗</a>}</div></header>
    <section className="provenanceBar"><span><strong>Retrieved</strong> {d.retrieval_snapshot}</span><span><strong>SHA-256</strong> <code>{d.sha256||"not available"}</code></span><span><strong>Pages</strong> {d.page_count}</span><span><strong>Extraction</strong> {d.native_pages} native · {d.ocr_pages} OCR</span></section>
    <nav className="evidenceTabs"><button className={tab==="document"?"active":""} onClick={()=>setTab("document")}>FDA document</button><button className={tab==="facts"?"active":""} onClick={()=>setTab("facts")}>Extracted facts <b>{data.claims.length}</b></button><button className={tab==="review"?"active":""} onClick={()=>setTab("review")}>Review record <b>{reviewed}/{data.claims.length}</b></button></nav>
    {d.source_status!=="available"?<MissingDocument d={d}/>:<>
      {tab==="document"&&<section className="documentWorkspace"><aside><label><span>Search transcription</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this FDA document"/></label><div className="pageJumps">{[...new Set(data.blocks.map(b=>b.page))].map(p=><button key={p} onClick={()=>document.getElementById(`${kNumber}-page-${p}`)?.scrollIntoView({behavior:"smooth"})}>Page {p}</button>)}</div><p>Unofficial research transcription. Page breaks and extraction method are preserved. Consult the FDA PDF for the official record.</p></aside><article className="transcript"><header><h2>Complete HTML transcription</h2><p>{filteredBlocks.length} structured blocks · {search?"filtered search view":"all pages in source order"}</p></header>{filteredBlocks.map((b,i)=><div key={b.block_id}>{(i===0||filteredBlocks[i-1]?.page!==b.page)&&<div id={`${kNumber}-page-${b.page}`} className="pageMarker"><span>FDA page {b.page}</span><small>{b.extraction_method}</small></div>}<div id={b.block_id} className={`transcriptBlock ${b.type} ${highlight===b.block_id?"highlighted":""}`}><a href={`#${b.block_id}`}>{b.block_id}</a>{b.type==="heading"?<h3>{b.text}</h3>:<p>{b.text}</p>}</div></div>)}</article></section>}
      {tab==="facts"&&<FactsTable claims={data.claims} merged={merged} goEvidence={goEvidence}/>} 
      {tab==="review"&&<section className="reviewWorkspace"><div className="reviewToolbar"><div><h2>Human adjudication record</h2><p>Changes stay in this browser until exported. Commit a validated JSON packet or workbook to make them authoritative.</p></div><button onClick={()=>importRef.current?.click()}>Import JSON</button><input ref={importRef} hidden type="file" accept="application/json" onChange={e=>importPacket(e.target.files?.[0])}/><button onClick={exportPacket}>Export review JSON</button></div><div className="reviewProgress"><strong>{reviewed}</strong> reviewed · <span>{data.claims.length-reviewed} pending</span></div><div className="reviewCards">{data.claims.map(c=>{const v=merged(c);return <article key={c.claim_id}><header><div><span>{fieldLabels[c.field]||c.field}</span><h3>{v.reviewed_value||c.normalized_value}</h3></div><button onClick={()=>goEvidence(c)}>Page {c.page} · view evidence</button></header><blockquote>{c.supporting_excerpt||"No supporting excerpt was established."}</blockquote><div className="reviewControls"><label><span>Decision</span><select value={v.review_decision} onChange={e=>update(c,{review_decision:e.target.value,reviewer_date:today()})}>{decisionOptions.map(x=><option key={x}>{x}</option>)}</select></label><label><span>Reviewed value</span><input value={v.reviewed_value} placeholder={c.normalized_value} onChange={e=>update(c,{reviewed_value:e.target.value})}/></label><label><span>Reviewer date</span><input type="date" value={v.reviewer_date} onChange={e=>update(c,{reviewer_date:e.target.value})}/></label><label className="notes"><span>Reviewer notes</span><textarea value={v.reviewer_notes} onChange={e=>update(c,{reviewer_notes:e.target.value})}/></label></div><footer><code>{c.claim_id}</code><span className={`match ${c.evidence_text_match}`}>{c.evidence_text_match} text match</span><span>{c.interpretation_status}</span></footer></article>})}</div></section>}
    </>}
    <footer className="evidenceFooter">Unofficial research transcription · FDA remains the ultimate regulatory source · No FDA endorsement implied</footer>
  </main>
}

function FactsTable({claims,merged,goEvidence}:{claims:Claim[];merged:(c:Claim)=>Claim;goEvidence:(c:Claim)=>void}){
  return <section className="factsWorkspace"><div className="sectionIntro"><h2>Atomic extracted facts</h2><p>Each technical field stands alone and carries its own exact evidence. Pending and unsupported facts are excluded from verified aggregation.</p></div><div className="tableWrap"><table><thead><tr><th>Field</th><th>Proposed conclusion</th><th>Exact FDA evidence</th><th>Location</th><th>Interpretation</th><th>Review</th></tr></thead><tbody>{claims.map(c=>{const v=merged(c);return <tr id={`claim-${c.claim_id}`} key={c.claim_id}><td><strong>{fieldLabels[c.field]||c.field}</strong><small>{c.claim_id}</small></td><td>{v.reviewed_value||c.normalized_value}<small>Source wording: {c.source_value}</small></td><td><button className="quoteButton" onClick={()=>goEvidence(c)}>“{c.supporting_excerpt||"Evidence not established"}”</button></td><td><button className="pageLink" onClick={()=>goEvidence(c)}>Page {c.page}<small>{c.section} · {c.block_id||"no block"}</small></button></td><td><span className={`match ${c.evidence_text_match}`}>{c.evidence_text_match}</span><small>{c.interpretation_status}</small></td><td><span className={`reviewState ${v.review_decision.replaceAll(" ","-")}`}>{v.review_decision}</span></td></tr>})}</tbody></table></div></section>
}

function MissingDocument({d}:{d:DocumentRow}){return <section className="missingDocument"><span>FDA SOURCE UNAVAILABLE</span><h2>This clearance remains in the corpus.</h2><p>No public PDF was retrieved for {d.k_number}. The record page is preserved, but it contributes no technical facts to verified Table 8.3.</p><dl><dt>Device</dt><dd>{d.device_name}</dd><dt>Applicant</dt><dd>{d.applicant}</dd><dt>Product code</dt><dd>{d.product_code}</dd><dt>Next action</dt><dd>Check alternate FDA URLs, archived records, applicant availability, then the documented FOIA queue.</dd></dl>{d.fda_detail_url&&<a href={d.fda_detail_url} target="_blank" rel="noreferrer">Open FDA database record ↗</a>}</section>}
