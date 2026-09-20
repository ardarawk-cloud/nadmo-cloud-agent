import "dotenv/config";
import { closeDb, listLeads, logActivity, saveVerification } from "./db.js";
import { rankLeads } from "./qualify.js";
import { verifyLeadOnWeb } from "./verify-web.js";

function parseLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 25));
}

async function main() {
  const limit = parseLimit(process.argv[2]);
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    console.error("SERPER_API_KEY is missing in .env");
    process.exitCode = 2;
    return;
  }

  const actionable = rankLeads(listLeads())
    .filter((lead) => lead.recommendation === "ACTIONABLE_VERIFY")
    .slice(0, limit);

  console.log("NADMO Cloud Agent v0.5 — Web Verification");
  console.log(`Verifying ${actionable.length} actionable candidates...\n`);

  let hasWebsite = 0;
  let potentialLead = 0;

  for (const lead of actionable) {
    try {
      const result = await verifyLeadOnWeb(lead, apiKey);
      saveVerification(result);

      if (result.verdict === "HAS_WEBSITE") hasWebsite += 1;
      if (result.verdict === "POTENTIAL_LEAD") potentialLead += 1;

      console.log({
        name: lead.name,
        verdict: result.verdict,
        officialUrl: result.officialUrl,
        phone: lead.phone,
        email: lead.email,
        instagram: lead.instagram
      });

      logActivity("WEB_VERIFY", {
        leadId: lead.id,
        name: lead.name,
        verdict: result.verdict,
        officialUrl: result.officialUrl
      });
    } catch (error) {
      console.error(`Verification failed for ${lead.name}: ${error.message}`);
      logActivity("WEB_VERIFY_ERROR", {
        leadId: lead.id,
        name: lead.name,
        error: error.message
      });
    }
  }

  console.log("\nVerification summary:");
  console.log({
    checked: actionable.length,
    hasWebsite,
    potentialLead
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
