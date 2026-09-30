import { chromium } from "playwright";
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

async function fetchStatus(page, base, leadId) {
  const url = `${base}/?bridge=status&leadId=${encodeURIComponent(leadId)}`;

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.browserTimeoutMs
  });

  await page.waitForFunction(
    () => Boolean(document.body.dataset.bridgeReady),
    undefined,
    { timeout: config.browserTimeoutMs }
  );

  const bridgeState = await page.evaluate(
    () => document.body.dataset.bridgeReady || ""
  );

  const raw = await page.locator("#bridge-output").textContent();

  if (!raw) {
    throw new Error("Approval bridge returned no JSON payload.");
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Approval bridge returned invalid JSON: ${error.message}`);
  }

  if (bridgeState !== "1") {
    throw new Error(
      `Approval bridge error: ${data?.error || "unknown bridge error"}`
    );
  }

  return data;
}

async function syncLead(page, lead) {
  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  const data = await fetchStatus(page, base, lead.id);
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
    lastFollowUpAt:
      data.lastFollowUpAt ?? timestampFor(events, "FOLLOW_UP_SENT")
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

  if (leads.length === 0) {
    logActivity("OUTREACH_STATUS_SYNC", summary);
    console.log("NADMO Scout pipeline sync:", summary);
    return;
  }

  const browser = await chromium.launch({ headless: config.headless });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(config.browserTimeoutMs);

    for (const lead of leads) {
      try {
        const status = await syncLead(page, lead);
        summary.checked += 1;
        summary[status] = (summary[status] || 0) + 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`Lead ${lead.id} sync failed: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
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
