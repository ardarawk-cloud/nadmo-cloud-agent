import { discoverLocalBusinesses } from "./local-discover.js";
import { closeDb, logActivity, upsertLead } from "./db.js";
import { config } from "./config.js";

function parseLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 30));
}

async function main() {
  const location = process.argv[2];
  const category = process.argv[3];
  const limit = parseLimit(process.argv[4]);

  console.log("NADMO Cloud Agent v0.2 — Local Discovery");
  console.log("Safety gates:", config.safety);

  if (!location || !category) {
    console.log("\nUsage:");
    console.log('  npm run discover:local -- "Denpasar, Bali, Indonesia" "makeup artist" 5');
    return;
  }

  console.log(`\nSearching ${category} in ${location}...`);
  const found = await discoverLocalBusinesses(location, category, limit);
  console.log(`Resolved area: ${found.location}`);
  console.log(`Found ${found.results.length} local candidates.`);

  logActivity("LOCAL_DISCOVERY_QUERY", {
    location,
    resolvedLocation: found.location,
    category,
    requestedLimit: limit,
    discoveredCount: found.results.length
  });

  for (const lead of found.results) {
    upsertLead(lead);
    logActivity("LOCAL_DISCOVERY_LEAD", {
      name: lead.name,
      sourceUrl: lead.sourceUrl,
      status: lead.status
    });
    console.log("\n", {
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      instagram: lead.instagram,
      sourceUrl: lead.sourceUrl,
      status: lead.status
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  closeDb();
});
