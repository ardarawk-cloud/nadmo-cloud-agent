import { config } from "./config.js";
import {
  closeDb,
  listReviewLeads,
  logActivity,
  upsertLeadOutreachStatus
} from "./db.js";

function timestampFor(events, status) {
  return events.find((event) => event.status === status)?.createdAt ?? null;
}

async function syncLead(lead) {
  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/status/${lead.id}`);

  if (!response.ok) {
    throw new Error(`Approval gateway HTTP ${response.status}`);
  }

  const data = await response.json();
  const events = Array.isArray(data.events) ? data.events : [];
  const latestStatus = data.latestStatus || "REVIEW_PENDING";

  upsertLeadOutreachStatus({
    leadId: lead.id,
    status: latestStatus,
    approvedAt: timestampFor(events, "APPROVED"),
    contactedAt: timestampFor(events, "CONTACTED")
  });

  return latestStatus;
}

async function main() {
  const leads = listReviewLeads();
  const summary = {
    checked: 0,
    reviewPending: 0,
    approved: 0,
    contacted: 0,
    failed: 0
  };

  for (const lead of leads) {
    try {
      const status = await syncLead(lead);
      summary.checked += 1;

      if (status === "CONTACTED") summary.contacted += 1;
      else if (status === "APPROVED") summary.approved += 1;
      else summary.reviewPending += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`Lead ${lead.id} sync failed: ${error.message}`);
    }
  }

  logActivity("OUTREACH_STATUS_SYNC", summary);
  console.log("NADMO Scout outreach status sync:", summary);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
