import {
  clearDiscordNotification,
  closeDb,
  getLeadRetryDiagnostic,
  listReviewNotificationStatus
} from "./db.js";

function parseLeadId(raw) {
  const id = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function explainRetryState(lead) {
  if (!lead) return "Lead ID not found in the local Scout database.";

  if (lead.retryState === "NO_VERIFICATION") {
    return "Lead exists, but has no current verification result.";
  }

  if (lead.retryState === "VERDICT_NOT_REVIEW_READY") {
    return `Current verifier verdict is ${lead.verdict}; only NO_OFFICIAL_SITE_FOUND, SOCIAL_ONLY, or DEAD_WEBSITE can be resent as sales leads.`;
  }

  if (lead.retryState === "NO_PUBLIC_CONTACT") {
    return "Lead has no currently stored public phone, email, or Instagram contact.";
  }

  return "Lead is review-ready.";
}

async function main() {
  const leadId = parseLeadId(process.argv[2]);

  if (!leadId) {
    console.error("Usage: npm run notify:retry -- <leadId>");
    process.exitCode = 2;
    return;
  }

  const rows = listReviewNotificationStatus();
  const lead = rows.find((row) => row.id === leadId);

  if (!lead) {
    const diagnostic = getLeadRetryDiagnostic(leadId);

    console.error(`Lead ${leadId} is not currently review-ready.`);
    console.error(explainRetryState(diagnostic));

    if (diagnostic) {
      console.error({
        id: diagnostic.id,
        name: diagnostic.name,
        verifierVerdict: diagnostic.verdict ?? null,
        phone: diagnostic.phone ?? null,
        email: diagnostic.email ?? null,
        instagram: diagnostic.instagram ?? null,
        checkedAt: diagnostic.checkedAt ?? null,
        retryState: diagnostic.retryState
      });
    }

    process.exitCode = 3;
    return;
  }

  const result = clearDiscordNotification(leadId);

  console.log({
    id: lead.id,
    name: lead.name,
    cleared: result.changes > 0,
    nextStep: "npm run notify"
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
