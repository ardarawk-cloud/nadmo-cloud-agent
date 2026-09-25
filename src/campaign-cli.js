import { discoverLocalBusinesses } from "./local-discover.js";
import { closeDb, listLeads, logActivity, upsertLead } from "./db.js";
import { rankLeads } from "./qualify.js";

const DEFAULT_CATEGORIES = [
  "makeup artist",
  "beauty salon",
  "guest house",
  "villa",
  "cafe",
  "restaurant"
];

function parseLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 25));
}

async function main() {
  const location = process.argv[2] || "Denpasar, Bali, Indonesia";
  const perCategory = parseLimit(process.argv[3]);

  console.log("NADMO Cloud Agent v0.4 — Local Campaign");
  console.log(`Location: ${location}`);
  console.log(`Categories: ${DEFAULT_CATEGORIES.join(", ")}`);
  console.log("");

  for (const category of DEFAULT_CATEGORIES) {
    try {
      console.log(`Discovering: ${category}`);
      const found = await discoverLocalBusinesses(location, category, perCategory);
      console.log(`  found ${found.results.length}`);

      for (const lead of found.results) {
        upsertLead(lead);
      }

      logActivity("CAMPAIGN_DISCOVERY", {
        location,
        category,
        discoveredCount: found.results.length
      });
    } catch (error) {
      console.error(`  failed: ${error.message}`);
      logActivity("CAMPAIGN_DISCOVERY_ERROR", {
        location,
        category,
        error: error.message
      });
    }
  }

  const ranked = rankLeads(listLeads());
  const actionable = ranked
    .filter((lead) => lead.recommendation === "ACTIONABLE_VERIFY")
    .slice(0, 20);
  const researchNeeded = ranked.filter((lead) => lead.recommendation === "RESEARCH_NEEDED").length;
  const hasWebsite = ranked.filter((lead) => lead.recommendation === "HAS_WEBSITE").length;

  console.log("\nActionable verification queue:");
  if (actionable.length === 0) {
    console.log("No actionable leads yet. Candidates without public contact were kept as RESEARCH_NEEDED.");
  }

  for (const lead of actionable) {
    console.log({
      name: lead.name,
      score: lead.score,
      recommendation: lead.recommendation,
      phone: lead.phone,
      email: lead.email,
      instagram: lead.instagram,
      sourceUrl: lead.sourceUrl
    });
  }

  console.log("\nCampaign summary:");
  console.log({
    actionableVerify: actionable.length,
    researchNeeded,
    hasWebsite,
    totalDiscoveryRecords: ranked.length
  });

  logActivity("CAMPAIGN_SUMMARY", {
    location,
    actionableVerify: actionable.length,
    researchNeeded,
    hasWebsite,
    totalDiscoveryRecords: ranked.length
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
