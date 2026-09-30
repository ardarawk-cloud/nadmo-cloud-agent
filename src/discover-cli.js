import { discoverUrls } from "./discover.js";
import { inspectUrl } from "./scout.js";
import { closeDb, logActivity, upsertLead } from "./db.js";
import { config } from "./config.js";

function parseLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 20));
}

async function main() {
  const query = process.argv[2];
  const limit = parseLimit(process.argv[3]);
  console.log("NADMO Cloud Agent v0.2 — Discovery Test");
  console.log("Safety gates:", config.safety);
  if (!query) {
    console.log("\nUsage:");
    console.log('  npm run discover -- "makeup artist denpasar bali" 10');
    return;
  }
  console.log(`\nDiscovering up to ${limit} results for: ${query}`);
  const urls = await discoverUrls(query, limit);
  logActivity("DISCOVERY_QUERY", { query, requestedLimit: limit, discoveredCount: urls.length });
  console.log(`Found ${urls.length} candidate URLs.`);
  for (const url of urls) {
    try {
      console.log(`\nInspecting: ${url}`);
      const lead = await inspectUrl(url);
      upsertLead(lead);
      logActivity("DISCOVERY_INSPECT_URL", { query, sourceUrl: lead.sourceUrl, status: lead.status });
      console.log({ name: lead.name, sourceUrl: lead.sourceUrl, phone: lead.phone, email: lead.email, instagram: lead.instagram, status: lead.status });
    } catch (error) {
      logActivity("DISCOVERY_INSPECT_ERROR", { query, sourceUrl: url, error: error.message });
      console.error(`Failed: ${url}`);
      console.error(error.message);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  closeDb();
});
