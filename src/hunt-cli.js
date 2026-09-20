import "dotenv/config";
import { discoverLocalBusinesses } from "./local-discover.js";
import {
  closeDb,
  listLeads,
  listReviewLeads,
  logActivity,
  saveVerification,
  upsertLead
} from "./db.js";
import { rankLeads } from "./qualify.js";
import { verifyLeadOnWeb } from "./verify-web.js";

const AREAS = [
  "Denpasar, Bali, Indonesia",
  "Badung Regency, Bali, Indonesia",
  "Gianyar Regency, Bali, Indonesia"
];

const CATEGORIES = [
  "makeup artist",
  "beauty salon",
  "guest house",
  "cafe",
  "restaurant",
  "laundry",
  "gym",
  "dentist",
  "car rental",
  "tattoo"
];

function parseIntSafe(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

async function main() {
  const perCategory = parseIntSafe(process.argv[2], 8, 1, 20);
  const verifyLimit = parseIntSafe(process.argv[3], 20, 1, 40);
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    console.error("SERPER_API_KEY is missing in .env");
    process.exitCode = 2;
    return;
  }

  console.log("NADMO Cloud Agent v0.8 — Bali Lead Hunt");
  console.log(`Areas: ${AREAS.join(" | ")}`);
  console.log(`Categories: ${CATEGORIES.join(", ")}`);
  console.log(`Discovery limit/category: ${perCategory}`);
  console.log(`Verification limit: ${verifyLimit}\n`);

  let discovered = 0;

  for (const area of AREAS) {
    console.log(`AREA: ${area}`);

    for (const category of CATEGORIES) {
      try {
        const found = await discoverLocalBusinesses(area, category, perCategory);
        discovered += found.results.length;
        console.log(`  ${category}: ${found.results.length}`);

        for (const lead of found.results) upsertLead(lead);

        logActivity("HUNT_DISCOVERY", {
          area,
          category,
          discoveredCount: found.results.length
        });
      } catch (error) {
        console.log(`  ${category}: failed — ${error.message}`);
        logActivity("HUNT_DISCOVERY_ERROR", {
          area,
          category,
          error: error.message
        });
      }
    }
  }

  const actionable = rankLeads(listLeads())
    .filter((lead) => lead.recommendation === "ACTIONABLE_VERIFY")
    .slice(0, verifyLimit);

  console.log(`\nVerifying ${actionable.length} actionable candidates...\n`);

  for (const lead of actionable) {
    try {
      const result = await verifyLeadOnWeb(lead, apiKey);
      saveVerification(result);
      console.log(`${lead.name}: ${result.verdict}`);

      logActivity("HUNT_VERIFY", {
        leadId: lead.id,
        name: lead.name,
        verdict: result.verdict,
        officialUrl: result.officialUrl
      });
    } catch (error) {
      console.log(`${lead.name}: verification failed — ${error.message}`);
      logActivity("HUNT_VERIFY_ERROR", {
        leadId: lead.id,
        name: lead.name,
        error: error.message
      });
    }
  }

  const review = listReviewLeads();

  console.log("\n=== SALES REVIEW QUEUE ===");
  if (review.length === 0) {
    console.log("No review-ready leads in this run.");
  }

  for (const lead of review.slice(0, 20)) {
    console.log({
      name: lead.name,
      verifierVerdict: lead.verdict,
      phone: lead.phone,
      email: lead.email,
      instagram: lead.instagram,
      evidenceUrl: lead.officialUrl,
      sourceUrl: lead.sourceUrl
    });
  }

  console.log("\nHunt summary:");
  console.log({
    rawDiscoveriesThisRun: discovered,
    actionableVerified: actionable.length,
    reviewReadyInDatabase: review.length
  });

  logActivity("HUNT_SUMMARY", {
    rawDiscoveriesThisRun: discovered,
    actionableVerified: actionable.length,
    reviewReadyInDatabase: review.length
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
