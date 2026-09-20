import { closeDb, listReviewLeads, logActivity } from "./db.js";

async function main() {
  const leads = listReviewLeads();

  console.log("NADMO Cloud Agent v0.6 — Review Queue");
  console.log("These are candidates where no official site was found by the verifier.");
  console.log("They are NOT proof that the business has no website. Human review is still required.\n");

  if (leads.length === 0) {
    console.log("No review-ready leads found.");
  }

  for (const lead of leads) {
    console.log({
      name: lead.name,
      reviewStatus: "QUALIFIED_REVIEW",
      phone: lead.phone,
      email: lead.email,
      instagram: lead.instagram,
      sourceUrl: lead.sourceUrl,
      checkedAt: lead.checkedAt
    });
  }

  console.log(`\nReview-ready leads: ${leads.length}`);

  logActivity("LIST_REVIEW_LEADS", {
    count: leads.length
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
