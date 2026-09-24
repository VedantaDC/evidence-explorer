// Regenerate the v2 review packet, review workbook, and verified-only Table 8.3
// from the v2 documents plus the existing canonical packet (review fields win).
import { loadV2, writeArtifacts } from "./review-io.mjs";

const { docs, packet } = await loadV2();
if (packet) {
  const known = new Set(docs.flatMap((d) => [...d.claims.map((c) => c.claim_id), ...d.relationships.map((r) => r.relationship_id)]));
  const orphans = [...packet.claims, ...packet.relationships].map((x) => x.claim_id || x.relationship_id).filter((id) => !known.has(id));
  if (orphans.length) throw new Error(`Refusing to drop reviewed IDs missing from the v2 documents: ${orphans.join(", ")}`);
}
const { packet: out, table83 } = await writeArtifacts(docs);
console.log(JSON.stringify({ claims: out.claims.length, relationships: out.relationships.length, table83_rows: table83.rows.length }));
