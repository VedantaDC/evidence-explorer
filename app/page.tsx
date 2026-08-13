"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type Pair = [string, number];
type Family = {
  device_family_id: string; family_name: string; latest_device_name: string;
  latest_applicant: string; device_archetype: string; earliest_decision_date: string;
  latest_decision_date: string; clearance_count: string; k_numbers: string;
  indication_roles: string; standardized_outputs: string; quality_score: number;
  source_basis: string; analysis_tier: string;
};
type Sensor = {
  device_family_id: string; family_name: string; standardized_sensor: string;
  standardized_location: string; sensor_with_location: string; measurement: string;
  k_number: string; confidence: string; source_url: string; source_type: string;
};
type Output = {
  device_family_id: string; family_name: string; standardized_output: string;
  source_output_name: string; output_category: string; definition: string;
  k_number: string; source_url: string; source_type: string;
};
type Audit = {
  device_family_id: string; family_name: string; latest_decision_date: string;
  public_pdf_count: number; supplemental_source_count: number; source_basis: string;
  usable_sensor_rows: number; located_sensor_rows: number; usable_output_rows: number; indication_roles: string;
  quality_score: number; analysis_decision: string; analysis_tier: string; decision_reason: string;
};
type Clearance = { device_family_id: string; k_number: string; source_url: string };
type Payload = {
  stats: {
    snapshot_date: string; total_families_audited: number; included_families: number;
    excluded_families: number; inclusion_rate: number; included_clearances: number;
    interpretable_sensor_facts: number; standardized_output_facts: number; rubric: string[];
    core_families: number; expanded_families: number; historical_families: number;
    sensor_counts: Pair[]; location_counts: Pair[]; measurement_counts: Pair[];
    output_family_counts: Pair[]; indication_counts: Pair[]; archetype_counts: Pair[];
    year_band_counts: Pair[]; exclusion_reason_counts: Pair[];
  };
  families: Family[]; sensors: Sensor[]; outputs: Output[]; audit: Audit[];
  clearances: Clearance[];
};

type OtherFamily = { family_id:string; family_name:string; product_code:string; k_numbers:string; decision_date:string; applicant:string; indication_role:string; indications_short:string; indications_verbatim:string; scope_basis:string; standardized_outputs:string; source_url:string };
type OtherSensor = { family_id:string; family_name:string; product_code:string; k_number:string; sensor:string; location:string; measurement:string; sensor_outputs:string; source_url:string };
type OtherOutput = { family_id:string; family_name:string; product_code:string; k_number:string; standardized_output:string; source_url:string };
type OtherAudit = { product_code:string; k_number:string; decision_date:string; device_name:string; applicant:string; analysis_decision:string; scope_category:string; decision_reason:string; pdf_status:string; text_available:boolean; evidence_excerpt:string; source_url:string };
type OtherPayload = { stats:{ product_codes:string[]; total_clearances_screened:number; included_clearances:number; included_families:number; excluded_clearances:number; olv_clearances:number; olz_clearances:number; olv_included:number; olz_included:number; sensor_facts:number; output_facts:number; exclusion_category_counts:Pair[]; scope_rule:string }; families:OtherFamily[]; sensors:OtherSensor[]; outputs:OtherOutput[]; audit:OtherAudit[] };

const palette = ["#00a7a5", "#195b8a", "#f29d49", "#7559a6", "#6a9f58", "#dc6b6b"];

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function Metric({ value, label, note }: { value: string | number; label: string; note: string }) {
  return <div className="metric"><div className="metricValue">{value}</div><div className="metricLabel">{label}</div><div className="metricNote">{note}</div></div>;
}

function BarChart({ title, data, limit = 10, denominator }: { title: string; data: Pair[]; limit?: number; denominator?: number }) {
  const rows = data.slice(0, limit);
  const max = Math.max(...rows.map(([, v]) => v), 1);
  return <section className="chartCard">
    <h3>{title}</h3>
    <div className="bars">{rows.map(([label, value]) => <div className="barRow" key={label}>
      <div className="barLabel" title={label}>{label}</div>
      <div className="barTrack"><div className="barFill" style={{ width: `${(value / max) * 100}%` }} /></div>
      <div className="barValue">{value}{denominator ? <span> / {denominator}</span> : null}</div>
    </div>)}</div>
  </section>;
}

function Donut({ included, excluded }: { included: number; excluded: number }) {
  const total = included + excluded;
  const pct = total ? (included / total) * 100 : 0;
  return <section className="chartCard donutCard">
    <div><h3>Evidence-screen disposition</h3><p className="muted">All provisional families were evaluated individually.</p></div>
    <div className="donutWrap">
      <div className="donut" style={{ background: `conic-gradient(#00a7a5 0 ${pct}%, #dce5ea ${pct}% 100%)` }}>
        <div><strong>{Math.round(pct)}%</strong><span>included</span></div>
      </div>
      <div className="legend"><div><i className="swatch included" /> Included <strong>{included}</strong></div><div><i className="swatch excluded" /> Excluded <strong>{excluded}</strong></div></div>
    </div>
  </section>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <label className="filter"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}><option value="">All</option>{options.map(v => <option key={v}>{v}</option>)}</select></label>;
}

function SourceBadge({ type }: { type: string }) {
  const supplemental = type !== "FDA 510(k)";
  return <span className={`sourceBadge ${supplemental ? "supplemental" : "fda"}`}>{supplemental ? "Supplemental" : "FDA"}</span>;
}

function CorpusNav({ corpus, setCorpus }: { corpus:"mnr"|"other"; setCorpus:(value:"mnr"|"other")=>void }) {
  return <nav className="corpusNav" aria-label="Research corpus">
    <span>Research corpus</span>
    <button className={corpus === "mnr" ? "active" : ""} onClick={() => setCorpus("mnr")}>MNR devices</button>
    <button className={corpus === "other" ? "active" : ""} onClick={() => setCorpus("other")}>Other product codes · OLV / OLZ</button>
  </nav>;
}

function OtherCodesView({ data, setCorpus }: { data:OtherPayload; setCorpus:(value:"mnr"|"other")=>void }) {
  const [view,setView]=useState("overview");
  const [query,setQuery]=useState("");
  const [code,setCode]=useState("");
  const [decision,setDecision]=useState("");
  const [category,setCategory]=useState("");
  const outputCounts=useMemo(()=>Object.entries(data.outputs.reduce((a,o)=>{a[o.standardized_output]=(a[o.standardized_output]||0)+1;return a;},{} as Record<string,number>)).sort((a,b)=>b[1]-a[1]) as Pair[],[data]);
  const sensorCounts=useMemo(()=>Object.entries(data.sensors.reduce((a,s)=>{a[s.sensor]=(a[s.sensor]||0)+1;return a;},{} as Record<string,number>)).sort((a,b)=>b[1]-a[1]) as Pair[],[data]);
  const audit=data.audit.filter(a=>(!query||`${a.device_name} ${a.applicant} ${a.k_number}`.toLowerCase().includes(query.toLowerCase()))&&(!code||a.product_code===code)&&(!decision||a.analysis_decision===decision)&&(!category||a.scope_category===category));
  return <main><CorpusNav corpus="other" setCorpus={setCorpus}/>
    <header className="hero otherHero"><div className="eyebrow">NEUROLOGY · PRODUCT CODES OLV / OLZ · LIMITED-CHANNEL SCOPE</div><div className="heroGrid"><div><h1>Which Neurology clearances actually function as home sleep-apnea tests?</h1><p>Reduced-channel configurations are included when the FDA summary identifies them clearly. Full PSG-only systems and software-only scoring remain outside scope.</p></div><div className="heroStamp"><span>Clearances screened</span><strong>{data.stats.total_clearances_screened}</strong><small>{data.stats.olv_clearances} OLV · {data.stats.olz_clearances} OLZ</small></div></div></header>
    <nav className="tabs" aria-label="Other code views">{[["overview","Overview"],["families","Included configurations"],["sensors","Sensor facts"],["outputs","Outputs"],["audit","Scope audit"],["methods","Methods"]].map(([id,label])=><button key={id} className={view===id?"active":""} onClick={()=>setView(id)}>{label}</button>)}<a className="download" href="/MNR_Curated_Analysis.xlsx" download>Download combined Excel</a></nav>
    {view==="overview"&&<div className="page"><section className="metrics"><Metric value={data.stats.included_families} label="included configurations" note={`of ${data.stats.total_clearances_screened} clearances screened`}/><Metric value={data.stats.olv_included} label="OLV included" note={`of ${data.stats.olv_clearances} OLV clearances`}/><Metric value={data.stats.olz_included} label="OLZ included" note={`of ${data.stats.olz_clearances} OLZ clearances`}/><Metric value={data.stats.sensor_facts} label="sensor facts" note={`${data.stats.output_facts} normalized output facts`}/></section><section className="insight"><div><span className="insightNumber">7</span><span className="insightText">qualifying limited-channel configurations. Mixed systems are counted only for their reduced configuration: Nox polygraphy, SOMNOscreen plus cardiorespiratory, and Cerebra Level 3 HSAT. Their full PSG configurations are not analyzed here.</span></div></section><div className="chartGrid"><Donut included={data.stats.included_clearances} excluded={data.stats.excluded_clearances}/><BarChart title="Why clearances were excluded" data={data.stats.exclusion_category_counts}/></div><div className="chartGrid"><BarChart title="Sensors in included configurations" data={sensorCounts}/><BarChart title="Outputs in included configurations" data={outputCounts}/></div></div>}
    {view==="families"&&<div className="page wide"><div className="sectionHead"><div><h2>Included limited-channel configurations</h2><p>For mixed systems, the configuration name and scope basis explicitly separate HSAT from full PSG.</p></div></div><div className="tableWrap"><table><thead><tr><th>Device / configuration</th><th>Code & 510(k)</th><th>Indication</th><th>Reduced-channel scope</th><th>Sensors</th><th>Outputs</th></tr></thead><tbody>{data.families.map(f=><tr key={f.family_id}><td><strong>{f.family_name}</strong><small>{f.applicant} · {f.decision_date}</small></td><td><a href={f.source_url} target="_blank" rel="noreferrer">{f.product_code} · {f.k_numbers}</a></td><td>{f.indications_short}<small>{f.indications_verbatim}</small></td><td>{f.scope_basis}</td><td>{data.sensors.filter(s=>s.family_id===f.family_id).map(s=>s.sensor).join("; ")}</td><td className="outputTags">{f.standardized_outputs.split("; ").map(o=><span key={o}>{o}</span>)}</td></tr>)}</tbody></table></div></div>}
    {view==="sensors"&&<div className="page wide"><div className="sectionHead"><div><h2>Sensor → location → measurement</h2><p>Location remains descriptive, not an inclusion requirement.</p></div><div className="resultCount"><strong>{data.sensors.length}</strong> facts</div></div><div className="tableWrap"><table><thead><tr><th>Configuration</th><th>Sensor</th><th>Location</th><th>Measures</th><th>Related outputs</th><th>FDA evidence</th></tr></thead><tbody>{data.sensors.map((s,i)=><tr key={`${s.family_id}-${i}`}><td><strong>{s.family_name}</strong></td><td>{s.sensor}</td><td>{s.location}</td><td>{s.measurement}</td><td>{s.sensor_outputs}</td><td><a href={s.source_url} target="_blank" rel="noreferrer">{s.k_number}</a></td></tr>)}</tbody></table></div></div>}
    {view==="outputs"&&<div className="page wide"><div className="sectionHead"><div><h2>Normalized outputs</h2><p>Only outputs supported for the included device/configuration are listed.</p></div><div className="resultCount"><strong>{data.outputs.length}</strong> facts</div></div><div className="tableWrap"><table><thead><tr><th>Configuration</th><th>Product code</th><th>Standardized output</th><th>FDA evidence</th></tr></thead><tbody>{data.outputs.map((o,i)=><tr key={`${o.family_id}-${i}`}><td><strong>{o.family_name}</strong></td><td>{o.product_code}</td><td><span className="outputPill">{o.standardized_output}</span></td><td><a href={o.source_url} target="_blank" rel="noreferrer">{o.k_number}</a></td></tr>)}</tbody></table></div></div>}
    {view==="audit"&&<div className="page wide"><div className="sectionHead"><div><h2>OLV / OLZ scope audit</h2><p>All 101 primary-code clearances remain visible, including unavailable historical PDFs.</p></div><div className="resultCount"><strong>{audit.length}</strong> rows</div></div><section className="filterPanel compact"><label className="filter search"><span>Search device, applicant, or K number</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search"/></label><Select label="Product code" value={code} options={["OLV","OLZ"]} onChange={setCode}/><Select label="Decision" value={decision} options={["Include","Exclude"]} onChange={setDecision}/><Select label="Category" value={category} options={unique(data.audit.map(a=>a.scope_category))} onChange={setCategory}/><button className="clear" onClick={()=>{setQuery("");setCode("");setDecision("");setCategory("")}}>Clear</button></section><div className="tableWrap"><table><thead><tr><th>Device</th><th>Code / 510(k)</th><th>Decision</th><th>Scope category</th><th>Reason</th><th>PDF</th></tr></thead><tbody>{audit.map(a=><tr key={a.k_number}><td><strong>{a.device_name}</strong><small>{a.applicant} · {a.decision_date}</small></td><td><a href={a.source_url} target="_blank" rel="noreferrer">{a.product_code} · {a.k_number}</a></td><td><span className={`decision ${a.analysis_decision.toLowerCase()}`}>{a.analysis_decision}</span></td><td>{a.scope_category}</td><td>{a.decision_reason}</td><td>{a.pdf_status}</td></tr>)}</tbody></table></div></div>}
    {view==="methods"&&<div className="page methods"><div className="eyebrow dark">CONFIGURATION-SPECIFIC SCREENING</div><h2>Reduced configurations count; full PSG channels do not</h2><p className="lede">{data.stats.scope_rule}</p><section className="methodGrid"><div className="steps">{["Enumerate every primary OLV and OLZ 510(k) in openFDA.","Download the FDA-hosted summary and OCR scanned pages.","Include direct limited-channel HSAT devices and explicitly documented reduced-channel configurations.","For mixed systems, extract only the reduced polygraphy/Level 3/cardiorespiratory sensor set.","Exclude software-only scoring, full-PSG-only systems, and standalone components; retain every decision in the audit."].map((x,i)=><div key={x}><span>{String(i+1).padStart(2,"0")}</span><p>{x}</p></div>)}</div><aside><h3>Interpretation boundary</h3><p>“Available configuration” must be stated or clearly described in the FDA summary. A hypothetical ability to omit channels is not enough.</p><h3>Review status</h3><p>This remains a machine-assisted research draft and should receive expert adjudication before publication.</p></aside></section></div>}
    <footer><span>MNR Evidence Explorer · OLV/OLZ extension</span><span>{data.stats.total_clearances_screened} screened → {data.stats.included_families} reduced-channel configurations included</span></footer>
  </main>;
}

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [otherData, setOtherData] = useState<OtherPayload | null>(null);
  const [corpus, setCorpus] = useState<"mnr"|"other">("mnr");
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [sensor, setSensor] = useState("");
  const [location, setLocation] = useState("");
  const [output, setOutput] = useState("");
  const [role, setRole] = useState("");
  const [archetype, setArchetype] = useState("");
  const [tier, setTier] = useState("");
  const [auditDecision, setAuditDecision] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { fetch("/dashboard_data.json").then(r => r.json()).then(setData); fetch("/other_codes_data.json").then(r=>r.json()).then(setOtherData); }, []);
  const sensorOptions = useMemo(() => data ? unique(data.sensors.map(x => x.standardized_sensor)) : [], [data]);
  const locationOptions = useMemo(() => data ? unique(data.sensors.map(x => x.standardized_location)) : [], [data]);
  const outputOptions = useMemo(() => data ? unique(data.outputs.map(x => x.standardized_output)) : [], [data]);
  const roleOptions = useMemo(() => data ? unique(data.families.flatMap(x => x.indication_roles.split("; "))) : [], [data]);
  const archetypeOptions = useMemo(() => data ? unique(data.families.map(x => x.device_archetype)) : [], [data]);

  const filteredFamilies = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    return data.families.filter(f => {
      const fs = data.sensors.filter(s => s.device_family_id === f.device_family_id);
      const fo = data.outputs.filter(o => o.device_family_id === f.device_family_id);
      return (!q || `${f.family_name} ${f.latest_applicant} ${f.k_numbers}`.toLowerCase().includes(q)) &&
        (!sensor || fs.some(s => s.standardized_sensor === sensor)) &&
        (!location || fs.some(s => s.standardized_location === location)) &&
        (!output || fo.some(o => o.standardized_output === output)) &&
        (!role || f.indication_roles.split("; ").includes(role)) &&
        (!archetype || f.device_archetype === archetype) &&
        (!tier || f.analysis_tier === tier);
    });
  }, [data, search, sensor, location, output, role, archetype, tier]);

  const filteredSensors = useMemo(() => {
    if (!data) return [];
    const ids = new Set(filteredFamilies.map(f => f.device_family_id));
    return data.sensors.filter(s => ids.has(s.device_family_id) && (!sensor || s.standardized_sensor === sensor) && (!location || s.standardized_location === location));
  }, [data, filteredFamilies, sensor, location]);

  const filteredOutputs = useMemo(() => {
    if (!data) return [];
    const ids = new Set(filteredFamilies.map(f => f.device_family_id));
    return data.outputs.filter(o => ids.has(o.device_family_id) && (!output || o.standardized_output === output));
  }, [data, filteredFamilies, output]);

  if (!data || !otherData) return <main className="loading"><div className="loadingMark" /><h1>Preparing the sleep-device evidence explorer…</h1></main>;
  if (corpus === "other") return <OtherCodesView data={otherData} setCorpus={setCorpus}/>;

  const kLinks = (familyId: string) => data.clearances.filter(c => c.device_family_id === familyId);
  const clearFilters = () => { setSearch(""); setSensor(""); setLocation(""); setOutput(""); setRole(""); setArchetype(""); setTier(""); };
  const filtersActive = Boolean(search || sensor || location || output || role || archetype || tier);

  return <main><CorpusNav corpus="mnr" setCorpus={setCorpus}/>
    <header className="hero">
      <div className="eyebrow">FDA PRODUCT CODE MNR · CURATED ANALYSIS</div>
      <div className="heroGrid"><div><h1>What can the strongest records actually tell us?</h1><p>Explore the device families with a complete, traceable sensor → location → physiological measurement → output chain.</p></div>
      <div className="heroStamp"><span>Evidence snapshot</span><strong>{data.stats.snapshot_date}</strong><small>Research draft · expert review required</small></div></div>
    </header>

    <nav className="tabs" aria-label="Analysis views">
      {[["overview","Overview"],["families","Family explorer"],["sensors","Sensor facts"],["outputs","Outputs"],["quality","Quality audit"],["methods","Methods"]].map(([id,label]) =>
        <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      <a className="download" href="/MNR_Curated_Analysis.xlsx" download>Download Excel</a>
    </nav>

    {tab === "overview" && <div className="page">
      <section className="metrics">
        <Metric value={data.stats.included_families} label="families retained" note={`of ${data.stats.total_families_audited} audited`} />
        <Metric value={data.stats.included_clearances} label="linked 510(k)s" note="across retained families" />
        <Metric value={data.stats.interpretable_sensor_facts} label="interpretable sensor facts" note="type + measurement; location when known" />
        <Metric value={data.stats.standardized_output_facts} label="traceable output facts" note="mapped to filterable labels" />
      </section>
      <section className="insight"><div><span className="insightNumber">{Math.round(data.stats.inclusion_rate * 100)}%</span><span className="insightText">of provisional families are now retained: {data.stats.core_families} core, {data.stats.expanded_families} expanded, and {data.stats.historical_families} historical. Missing location is shown as “Location not specified” and no longer causes exclusion by itself.</span></div></section>
      <div className="chartGrid"><Donut included={data.stats.included_families} excluded={data.stats.excluded_families} /><BarChart title="Most common standardized outputs" data={data.stats.output_family_counts} denominator={data.stats.included_families} /></div>
      <div className="chartGrid"><BarChart title="Most common sensor types" data={data.stats.sensor_counts} /><BarChart title="What the sensors measure" data={data.stats.measurement_counts} /></div>
      <div className="chartGrid"><BarChart title="Anatomical / use locations" data={data.stats.location_counts} /><BarChart title="Indication terminology" data={data.stats.indication_counts} denominator={data.stats.included_families} /></div>
      <section className="archetypes"><h2>Evidence tiers</h2><div className="archetypeGrid">{[["Core",data.stats.core_families],["Expanded",data.stats.expanded_families],["Historical",data.stats.historical_families],["Excluded",data.stats.excluded_families]].map(([name,count],i) => <div key={String(name)}><i style={{background: palette[i % palette.length]}} /><span>{name}</span><strong>{count}</strong></div>)}</div></section>
    </div>}

    {tab === "families" && <div className="page wide">
      <div className="sectionHead"><div><h2>Family explorer</h2><p>Filter at family level; expand a row to see standardized sensor and output details.</p></div><div className="resultCount"><strong>{filteredFamilies.length}</strong> families</div></div>
      <section className="filterPanel">
        <label className="filter search"><span>Search family, applicant, or K number</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g., WatchPAT or K223675" /></label>
        <Select label="Evidence tier" value={tier} options={["Core","Expanded","Historical"]} onChange={setTier} />
        <Select label="Indication" value={role} options={roleOptions} onChange={setRole} />
        <Select label="Sensor" value={sensor} options={sensorOptions} onChange={setSensor} />
        <Select label="Location" value={location} options={locationOptions} onChange={setLocation} />
        <Select label="Output" value={output} options={outputOptions} onChange={setOutput} />
        <Select label="Device type" value={archetype} options={archetypeOptions} onChange={setArchetype} />
        <button className="clear" disabled={!filtersActive} onClick={clearFilters}>Clear filters</button>
      </section>
      <div className="tableWrap"><table className="familyTable"><thead><tr><th>Device family</th><th>510(k)s</th><th>Indication terms</th><th>Sensor summary</th><th>Standardized outputs</th><th /></tr></thead><tbody>
        {filteredFamilies.map(f => {
          const fs = data.sensors.filter(s => s.device_family_id === f.device_family_id);
          const fo = unique(data.outputs.filter(o => o.device_family_id === f.device_family_id).map(o => o.standardized_output));
          const open = expanded === f.device_family_id;
          return <Fragment key={f.device_family_id}><tr className={open ? "open" : ""}>
            <td><strong>{f.family_name}</strong><small>{f.latest_applicant} · latest {f.latest_decision_date}</small><span className={`tierPill ${f.analysis_tier.toLowerCase()}`}>{f.analysis_tier}</span><span className="typePill">{f.device_archetype}</span></td>
            <td className="kLinks">{kLinks(f.device_family_id).map(k => <a key={k.k_number} href={k.source_url} target="_blank" rel="noreferrer">{k.k_number}</a>)}</td>
            <td>{f.indication_roles}</td><td>{fs.slice(0,3).map(s => s.sensor_with_location).join("; ")}{fs.length > 3 ? ` +${fs.length - 3} more` : ""}</td>
            <td className="outputTags">{fo.slice(0,6).map(x => <span key={x}>{x}</span>)}{fo.length > 6 && <span>+{fo.length - 6}</span>}</td>
            <td><button className="expand" onClick={() => setExpanded(open ? null : f.device_family_id)} aria-label={`${open ? "Collapse" : "Expand"} ${f.family_name}`}>{open ? "−" : "+"}</button></td>
          </tr>{open && <tr className="detailRow"><td colSpan={6}><div className="detailGrid">
            <div><h4>Sensor → measurement</h4>{fs.map((s,i) => <div className="fact" key={`${s.sensor_with_location}-${i}`}><div><strong>{s.sensor_with_location}</strong><span>{s.measurement}</span></div><a href={s.source_url} target="_blank" rel="noreferrer"><SourceBadge type={s.source_type} /> {s.k_number}</a></div>)}</div>
            <div><h4>Standardized outputs</h4><div className="tagCloud">{fo.map(x => <span key={x}>{x}</span>)}</div><p className="sourceNote">Source basis: {f.source_basis}</p></div>
          </div></td></tr>}</Fragment>;
        })}
      </tbody></table></div>
    </div>}

    {tab === "sensors" && <div className="page wide">
      <div className="sectionHead"><div><h2>Normalized sensor facts</h2><p>One row per distinct family-level sensor, location, and measured phenomenon.</p></div><div className="resultCount"><strong>{filteredSensors.length}</strong> facts</div></div>
      <section className="filterPanel compact"><label className="filter search"><span>Search family</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Family name" /></label><Select label="Sensor" value={sensor} options={sensorOptions} onChange={setSensor} /><Select label="Location" value={location} options={locationOptions} onChange={setLocation} /><Select label="Output used by family" value={output} options={outputOptions} onChange={setOutput} /><button className="clear" onClick={clearFilters}>Clear</button></section>
      <div className="tableWrap"><table><thead><tr><th>Family</th><th>Standardized sensor</th><th>Location</th><th>Measures</th><th>Evidence</th></tr></thead><tbody>{filteredSensors.map((s,i) => <tr key={`${s.device_family_id}-${s.standardized_sensor}-${i}`}><td><strong>{s.family_name}</strong></td><td>{s.standardized_sensor}</td><td>{s.standardized_location}</td><td>{s.measurement}</td><td><a href={s.source_url} target="_blank" rel="noreferrer"><SourceBadge type={s.source_type} /> {s.k_number}</a></td></tr>)}</tbody></table></div>
    </div>}

    {tab === "outputs" && <div className="page wide">
      <div className="sectionHead"><div><h2>Standardized outputs</h2><p>Variants such as pAHI, sAHI, and “apnea-hypopnea index” map to AHI while their source wording remains available.</p></div><div className="resultCount"><strong>{filteredOutputs.length}</strong> facts</div></div>
      <section className="filterPanel compact"><label className="filter search"><span>Search family</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Family name" /></label><Select label="Output" value={output} options={outputOptions} onChange={setOutput} /><Select label="Sensor used by family" value={sensor} options={sensorOptions} onChange={setSensor} /><button className="clear" onClick={clearFilters}>Clear</button></section>
      <div className="tableWrap"><table><thead><tr><th>Family</th><th>Standardized output</th><th>Source wording</th><th>Category</th><th>Available definition</th><th>Evidence</th></tr></thead><tbody>{filteredOutputs.map((o,i) => <tr key={`${o.device_family_id}-${o.standardized_output}-${i}`}><td><strong>{o.family_name}</strong></td><td><span className="outputPill">{o.standardized_output}</span></td><td>{o.source_output_name}</td><td>{o.output_category}</td><td className="definition">{o.definition || "Not further defined in source"}</td><td><a href={o.source_url} target="_blank" rel="noreferrer"><SourceBadge type={o.source_type} /> {o.k_number}</a></td></tr>)}</tbody></table></div>
    </div>}

    {tab === "quality" && <div className="page wide">
      <div className="sectionHead"><div><h2>Quality audit: all 105 families</h2><p>Nothing disappears silently. Every inclusion and exclusion is recorded with the same rule set.</p></div></div>
      <section className="qualitySummary"><Donut included={data.stats.included_families} excluded={data.stats.excluded_families} /><BarChart title="Why families were excluded" data={data.stats.exclusion_reason_counts} limit={8} /></section>
      <section className="filterPanel compact"><label className="filter search"><span>Search family</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Family name" /></label><Select label="Decision" value={auditDecision} options={["Include","Exclude"]} onChange={setAuditDecision} /><button className="clear" onClick={() => { setSearch(""); setAuditDecision(""); }}>Clear</button></section>
      <div className="tableWrap"><table><thead><tr><th>Family</th><th>Latest clearance</th><th>Decision / tier</th><th>Quality score</th><th>Usable sensors</th><th>With location</th><th>Usable outputs</th><th>Source basis / reason</th></tr></thead><tbody>{data.audit.filter(a => (!auditDecision || a.analysis_decision === auditDecision) && (!search || a.family_name.toLowerCase().includes(search.toLowerCase()))).map(a => <tr key={a.device_family_id}><td><strong>{a.family_name}</strong></td><td>{a.latest_decision_date}</td><td><span className={`decision ${a.analysis_decision.toLowerCase()}`}>{a.analysis_decision}</span><small>{a.analysis_tier}</small></td><td><span className="score">{a.quality_score}</span></td><td>{a.usable_sensor_rows}</td><td>{a.located_sensor_rows}</td><td>{a.usable_output_rows}</td><td><strong>{a.source_basis}</strong><small>{a.decision_reason}</small></td></tr>)}</tbody></table></div>
    </div>}

    {tab === "methods" && <div className="page methods">
      <div><div className="eyebrow dark">REPRODUCIBLE CURATION</div><h2>Layered by evidence strength</h2><p className="lede">The expanded set preserves useful sensor and output information without pretending that every source specifies an anatomical location.</p></div>
      <section className="methodGrid"><div className="steps">{data.stats.rubric.map((r,i) => <div key={r}><span>{String(i+1).padStart(2,"0")}</span><p>{r}</p></div>)}</div><aside><h3>How to read the evidence</h3><p><SourceBadge type="FDA 510(k)" /> means the fact is traceable to an FDA-hosted 510(k) document.</p><p><SourceBadge type="manufacturer labeling" /> means a documented gap was closed with current manufacturer labeling or peer-reviewed evidence.</p><p>Supplemental evidence never silently replaces FDA wording; the source type and URL remain attached to every added fact.</p><h3>Important limitation</h3><p>Family grouping, semantic extraction, standardization, and the inclusion screen remain machine-assisted and require expert adjudication before publication.</p></aside></section>
    </div>}

    <footer><span>MNR Evidence Explorer</span><span>164 clearances → 105 provisional families → {data.stats.included_families} retained across three tiers</span></footer>
  </main>;
}
