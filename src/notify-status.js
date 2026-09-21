import { closeDb, listReviewNotificationStatus } from "./db.js";

async function main() {
  const rows = listReviewNotificationStatus();

  console.log("NADMO Scout — Lead & Outreach Status\n");

  for (const row of rows) {
    console.log({
      id: row.id,
      name: row.name,
      verdict: row.verdict,
      outreachStatus: row.outreachStatus,
      approvedAt: row.approvedAt,
      contactedAt: row.contactedAt,
      sentToDiscord: Boolean(row.sent),
      sentAt: row.sentAt,
      checkedAt: row.checkedAt
    });
  }

  const sent = rows.filter((row) => row.sent).length;
  const unsent = rows.length - sent;
  const approved = rows.filter((row) => row.outreachStatus === "APPROVED").length;
  const contacted = rows.filter((row) => row.outreachStatus === "CONTACTED").length;
  const reviewPending = rows.filter((row) => row.outreachStatus === "REVIEW_PENDING").length;

  console.log("\nSummary:");
  console.log({
    reviewReady: rows.length,
    reviewPending,
    approved,
    contacted,
    sent,
    unsent
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
