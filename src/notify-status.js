import { closeDb, listReviewNotificationStatus } from "./db.js";

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

async function main() {
  const rows = listReviewNotificationStatus();

  console.log("NADMO Scout — Sales Pipeline Status\n");

  for (const row of rows) {
    console.log({
      id: row.id,
      name: row.name,
      verdict: row.verdict,
      outreachStatus: row.outreachStatus,
      approvedAt: row.approvedAt,
      contactedAt: row.contactedAt,
      repliedAt: row.repliedAt,
      interestedAt: row.interestedAt,
      proposalAt: row.proposalAt,
      wonAt: row.wonAt,
      lostAt: row.lostAt,
      lastFollowUpAt: row.lastFollowUpAt,
      sentToDiscord: Boolean(row.sent)
    });
  }

  const counts = Object.fromEntries(
    ORDER.map((status) => [
      status,
      rows.filter((row) => row.outreachStatus === status).length
    ])
  );

  console.log("\nPipeline summary:");
  console.log({ total: rows.length, ...counts });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
