import { config } from "./config.js";
import {
  closeDb,
  listReviewLeads,
  logActivity,
  upsertLeadOutreachStatus
} from "./db.js";

const PIPELINE_STATUSES = [
  "REVIEW_PENDING",
  "APPROVED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "PROPOSAL",
  "WON",
  "LOST"
];

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
  const latestStatus = PIPELINE_STATUSES.includes(data.latestStatus)
    ? data.latestStatus
    : "REVIEW_PENDING";

  upsertLeadOutreachStatus({
    leadId: lead.id,
    status: latestStatus,
    approvedAt: timestampFor(events, "APPROVED"),
    contactedAt: timestampFor(events, "CONTACTED"),
    repliedAt: timestampFor(events, "REPLIED"),
    interestedAt: timestampFor(events, "INTERESTED"),
    proposalAt: timestampFor(events, "PROPOSAL"),
    wonAt: timestampFor(events, "WON"),
    lostAt: timestampFor(events, "LOST"),
    lastFollowUpAt: data.lastFollowUpAt ?? timestampFor(events, "FOLLOW_UP_SENT")
  });

  return latestStatus;
}

async function main() {
  const leads = listReviewLeads();
  const summary = Object.fromEntries(PIPELINE_STATUSES.map((status) => [status, 0]));
  summary.checked = 0;
  summary.failed = 0;

  for (const lead of leads) {
    try {
      const status = await syncLead(lead);
      summary.checked += 1;
      summary[status] = (summary[status] || 0) + 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`Lead ${lead.id} sync failed: ${error.message}`);
    }
  }

  logActivity("OUTREACH_STATUS_SYNC", summary);
  console.log("NADMO Scout pipeline sync:", summary);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
