import "dotenv/config";
import { closeDb, listReviewLeads, logActivity } from "./db.js";

function label(verdict) {
  if (verdict === "DEAD_WEBSITE") return "DEAD WEBSITE";
  if (verdict === "SOCIAL_ONLY") return "SOCIAL ONLY";
  return "NO OFFICIAL SITE FOUND";
}

function lineFor(lead, index) {
  const contacts = [
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.instagram ? `Instagram: ${lead.instagram}` : null
  ].filter(Boolean).join(" | ");

  const evidence = lead.officialUrl ? `\nEvidence: ${lead.officialUrl}` : "";

  return [
    `**${index + 1}. ${lead.name}**`,
    `Status: ${label(lead.verdict)}`,
    contacts || "Contact: none",
    evidence
  ].join("\n");
}

function chunkMessages(header, items, max = 1800) {
  const chunks = [];
  let current = header;

  for (const item of items) {
    const next = `${current}\n\n${item}`;
    if (next.length > max) {
      chunks.push(current);
      current = item;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

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

  const leads = listReviewLeads();
  const header = [
    "**NADMO Scout — Sales Review Queue**",
    `Review-ready leads: ${leads.length}`,
    "Human review required before outreach."
  ].join("\n");

  const items = leads.map(lineFor);
  const chunks = chunkMessages(header, items);

  for (const chunk of chunks) {
    await sendDiscord(webhookUrl, chunk);
  }

  logActivity("DISCORD_NOTIFY", {
    leadCount: leads.length,
    messageCount: chunks.length
  });

  console.log(`Sent ${leads.length} review-ready leads to Discord in ${chunks.length} message(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
