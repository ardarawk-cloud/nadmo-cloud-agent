import { closeDb, listReviewLeads, logActivity } from "./db.js";

function reviewLabel(verdict) {
  if (verdict === "DEAD_WEBSITE") return "HIGH_VALUE_REVIEW";
  if (verdict === "SOCIAL_ONLY") return "SOCIAL_ONLY_REVIEW";
  return "QUALIFIED_REVIEW";
}

async function main() {
  const leads = listReviewLeads();

  console.log("NADMO Cloud Agent v0.7 — Sales Review Queue");
  console.log("Queue contains businesses with no active official website confirmed by the verifier.");
  console.log("Human review is still required before outreach.\n");

  if (leads.length === 0) console.log("No review-ready leads found.");

  for (const lead of leads) {
    console.log({
      name: lead.name,
      reviewStatus: reviewLabel(lead.verdict),
      verifierVerdict: lead.verdict,
      phone: lead.phone,
      email: lead.email,
      instagram: lead.instagram,
      evidenceUrl: lead.officialUrl,
      sourceUrl: lead.sourceUrl,
      checkedAt: lead.checkedAt
    });
  }

  console.log(`\nReview-ready leads: ${leads.length}`);
  logActivity("LIST_REVIEW_LEADS", { count: leads.length });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
