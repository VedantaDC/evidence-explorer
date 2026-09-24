// Validate a reviewed JSON packet or workbook and merge its review fields into the
// canonical v2 packet. Usage: node scripts/v2/import-review.mjs <file.json|file.xlsx> [--check-only]
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { mergePacket, validateIncoming } from "../../app/evidence-v2/model.mjs";
import { loadV2, readWorkbook, writeArtifacts } from "./review-io.mjs";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const checkOnly = process.argv.includes("--check-only");
if (!file) { console.error("usage: import-review.mjs <file.json|file.xlsx> [--check-only]"); process.exit(2); }
const url = pathToFileURL(file);
const incoming = file.endsWith(".xlsx") ? await readWorkbook(url) : JSON.parse(await fs.readFile(url, "utf8"));
const { packet } = await loadV2();
if (!packet) throw new Error("No canonical v2 packet; run scripts/v2/build-review-artifacts.mjs first");
const { errors, updates } = validateIncoming(packet, incoming);
if (errors.length) { console.error(errors.join("\n")); console.error(`${errors.length} error(s); nothing imported`); process.exit(1); }
if (!checkOnly) {
  const merged = mergePacket(packet, updates);
  const { docs } = await loadV2({ packetOverride: merged });
  await writeArtifacts(docs);
}
console.log(JSON.stringify({ valid: true, updated_items: Object.keys(updates).length, check_only: checkOnly }));
