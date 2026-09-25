import "dotenv/config";
import { config } from "./config.js";
import {
  closeDb,
  listFollowupDueLeads,
  logActivity,
  markFollowupReminderSent
} from "./db.js";

function normalizeWhatsappMobile(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith("628") || digits.length < 10 || digits.length > 15) {
    return null;
  }
  return digits;
}

function followupDraft(lead) {
  const name = lead.name || "bisnis Anda";
  return `Halo, saya Arda dari NADMO Studio. Saya follow up pesan sebelumnya terkait ${name}. Kalau saat ini ada kebutuhan untuk website atau perbaikan digital presence, saya bisa kirim contoh konsep dan estimasi singkat. Kalau belum menjadi prioritas, tidak masalah.`;
}

function followupUrl(lead) {
  const phone = normalizeWhatsappMobile(lead.phone);
  if (!phone) return null;

  const params = new URLSearchParams({
    leadId: String(lead.id),
    name: lead.name || "Lead",
    phone,
    text: followupDraft(lead)
  });

  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  params.set("bridge", "followup");
  return `${base}/?${params.toString()}`;
}

function stageUrl(lead, status) {
  const params = new URLSearchParams({
    leadId: String(lead.id),
    name: lead.name || "Lead",
    status
  });
  if (lead.phone) params.set("phone", lead.phone);

  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  params.set("bridge", "stage");
  return `${base}/?${params.toString()}`;
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

  const leads = listFollowupDueLeads();

  if (leads.length === 0) {
    console.log("No follow-up reminders due.");
    return;
  }

  for (const lead of leads) {
    const waFollowup = followupUrl(lead);
    const replied = stageUrl(lead, "REPLIED");
    const lost = stageUrl(lead, "LOST");

    const content = [
      "**🔁 NADMO Scout — FOLLOW-UP DUE**",
      `**${lead.name}**`,
      `Status: ${lead.outreachStatus}`,
      `Contacted: ${lead.contactedAt}`,
      lead.lastFollowUpAt ? `Last follow-up: ${lead.lastFollowUpAt}` : null,
      "",
      "Belum ada balasan setelah 3 hari.",
      waFollowup
        ? `[📲 Review & Follow-up WhatsApp](${waFollowup})`
        : "☎️ Phone-only lead — follow up manually.",
      `[💬 Mark REPLIED](${replied}) · [❌ Mark LOST](${lost})`
    ].filter(Boolean).join("\n");

    await sendDiscord(webhookUrl, content);
    markFollowupReminderSent(lead.id);
  }

  logActivity("FOLLOWUP_REMINDERS", { count: leads.length });
  console.log(`Sent ${leads.length} follow-up reminder(s) to Discord.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
