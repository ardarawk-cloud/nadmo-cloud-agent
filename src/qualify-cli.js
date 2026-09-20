import { closeDb, listLeads, logActivity } from "./db.js";
import { rankLeads } from "./qualify.js";

function parseLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 50));
}

async function main() {
  const limit = parseLimit(process.argv[2]);
  const ranked = rankLeads(listLeads()).slice(0, limit);

  console.log("NADMO Cloud Agent v0.2.2 — Lead Ranking");
  console.log("Important: 'no website' means no website was listed in the discovery source; verify before outreach.");
  console.log(`Showing top ${ranked.length} leads.\n`);

  for (const lead of ranked) {
    console.log({
      name: lead.name,
      score: lead.score,
      recommendation: lead.recommendation,
      phone: lead.phone,
      email: lead.email,
      instagram: lead.instagram,
      sourceUrl: lead.sourceUrl,
      reasons: lead.reasons
    });
  }

  logActivity("QUALIFY_LEADS", {
    totalAvailable: listLeads().length,
    returned: ranked.length
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
