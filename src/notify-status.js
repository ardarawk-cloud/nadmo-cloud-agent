import { closeDb, listReviewNotificationStatus } from "./db.js";

async function main() {
  const rows = listReviewNotificationStatus();

  console.log("NADMO Scout — Discord Notification Status\n");

  for (const row of rows) {
    console.log({
      id: row.id,
      name: row.name,
      verdict: row.verdict,
      sentToDiscord: Boolean(row.sent),
      sentAt: row.sentAt,
      checkedAt: row.checkedAt
    });
  }

  const sent = rows.filter((row) => row.sent).length;
  const unsent = rows.length - sent;

  console.log("\nSummary:");
  console.log({ reviewReady: rows.length, sent, unsent });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
