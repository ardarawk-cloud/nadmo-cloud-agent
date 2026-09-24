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

async function fetchStatus(base, leadId) {
  const url = `${base}/api/status?leadId=${encodeURIComponent(leadId)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Approval gateway HTTP ${response.status}: ${body.slice(0, 120)}`
    );
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `Approval gateway returned non-JSON (${contentType || "unknown"}): ${body.slice(0, 80)}`
    );
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `Approval gateway returned invalid JSON: ${error.message}`
    );
  }
}

async function syncLead(lead) {
  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  const data = await fetchStatus(base, lead.id);
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
  const summary = Object.fromEntries(
    PIPELINE_STATUSES.map((status) => [status, 0])
  );
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

  if (summary.failed > 0) {
    console.error(
      "Pipeline sync incomplete. Downstream summary/posting has been blocked."
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
