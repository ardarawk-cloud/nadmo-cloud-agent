import "dotenv/config";
import {
  closeDb,
  getPipelineDailySummary,
  listFollowupDueLeads,
  logActivity
} from "./db.js";

const ORDER = [
  "REVIEW_PENDING",
  "APPROVED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "PROPOSAL",
  "WON",
  "LOST"
];

async function sendDiscord(webhookUrl, content) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "NADMO Scout",
      content,
      allowed_mentions: { parse: [] }
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

async function main() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL is missing in .env");
    process.exitCode = 2;
    return;
  }

  const summary = getPipelineDailySummary();
  const due = listFollowupDueLeads();

  const lines = [
    "**📊 NADMO Scout — Daily Sales Summary**",
    `New review-ready (24h): **${summary.newReviewReady24h}**`,
    `Follow-up due: **${due.length}**`,
    "",
    ...ORDER.map((status) => `${status}: **${summary.counts[status] || 0}**`)
  ];

  await sendDiscord(webhookUrl, lines.join("\n"));
  logActivity("PIPELINE_DAILY_SUMMARY", {
    ...summary,
    followupDue: due.length
  });

  console.log("Daily sales summary sent to Discord.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
