import {
  clearDiscordNotification,
  closeDb,
  listReviewNotificationStatus
} from "./db.js";

function parseLeadId(raw) {
  const id = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(id) && id > 0 ? id : null;
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
    console.error(`Lead ${leadId} is not currently review-ready.`);
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
