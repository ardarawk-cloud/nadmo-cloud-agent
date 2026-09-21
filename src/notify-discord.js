import "dotenv/config";
import { config } from "./config.js";
import {
  closeDb,
  listReviewLeads,
  logActivity,
  markDiscordNotified
} from "./db.js";

function label(verdict) {
  if (verdict === "DEAD_WEBSITE") return "DEAD WEBSITE";
  if (verdict === "SOCIAL_ONLY") return "SOCIAL ONLY";
  return "NO OFFICIAL SITE FOUND";
}

function whatsappUrl(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith("62") || digits.length < 10) return null;
  return `https://wa.me/${digits}`;
}

function gatewayActionUrl(lead, action, draft = null) {
  if (!lead.phone) return null;

  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    leadId: String(lead.id),
    name: lead.name || "Lead",
    phone: lead.phone
  });

  if (draft) params.set("text", draft);
  return `${base}/api/${action}?${params.toString()}`;
}

function opportunityReason(verdict) {
  if (verdict === "DEAD_WEBSITE") {
    return "Website terdeteksi tidak aktif — peluang rebuild/recovery.";
  }
  if (verdict === "SOCIAL_ONLY") {
    return "Kehadiran online terdeteksi di sosial, tanpa website resmi aktif yang terverifikasi.";
  }
  return "Belum ditemukan website resmi setelah verifikasi — kandidat penawaran website.";
}

function outreachDraft(lead) {
  const name = lead.name || "bisnis Anda";
  const area = lead.area || "Bali";
  const category = lead.category ? ` (${lead.category})` : "";

  if (lead.verdict === "DEAD_WEBSITE") {
    return `Halo, saya Arda dari NADMO Studio. Saya menemukan ${name}${category} di ${area}. Saat pengecekan, website bisnisnya terlihat sedang tidak aktif. Kami membantu bisnis lokal memperbaiki atau membangun ulang website yang ringan, mobile-friendly, dan mudah dihubungkan ke WhatsApp. Kalau berkenan, saya bisa kirim contoh konsep singkat tanpa komitmen.`;
  }

  return `Halo, saya Arda dari NADMO Studio. Saya menemukan ${name}${category} di ${area}. Bisnisnya sudah aktif online, tapi saya belum menemukan website resmi yang aktif. Kami membantu bisnis lokal punya website sederhana, profesional, dan terhubung langsung ke WhatsApp. Kalau berkenan, saya bisa kirim contoh konsep singkat tanpa komitmen.`;
}

function discordCodeBlock(text) {
  return `\`\`\`text\n${String(text).replace(/\`\`\`/g, "'''")}\n\`\`\``;
}

function lineFor(lead, index) {
  const draft = outreachDraft(lead);
  const wa = whatsappUrl(lead.phone);
  const approveUrl = gatewayActionUrl(lead, "approve", draft);
  const contactedUrl = gatewayActionUrl(lead, "contacted");
  const contacts = [
    lead.phone ? `Phone: ${lead.phone}` : null,
    wa ? `WhatsApp: ${wa}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.instagram ? `Instagram: ${lead.instagram}` : null
  ].filter(Boolean);

  return [
    `**${index + 1}. ${lead.name}**`,
    lead.category ? `Category: ${lead.category}` : null,
    lead.area ? `Area: ${lead.area}` : null,
    `Website status: ${label(lead.verdict)}`,
    `Outreach status: ${lead.outreachStatus || "REVIEW_PENDING"}`,
    ...contacts,
    lead.officialUrl ? `Evidence: ${lead.officialUrl}` : null,
    `Opportunity: ${opportunityReason(lead.verdict)}`,
    "**Suggested outreach (manual review):**",
    discordCodeBlock(draft),
    approveUrl ? `**Action:** [✅ Approve & WhatsApp](${approveUrl})` : null,
    contactedUrl ? `**After sending:** [📌 Mark CONTACTED](${contactedUrl})` : null
  ].filter(Boolean).join("\n");
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

  const leads = listReviewLeads({ unsentOnly: true });

  if (leads.length === 0) {
    console.log("No new review-ready leads to send.");
    return;
  }

  const header = [
    "**NADMO Scout — Enriched Sales Leads + Outreach Draft**",
    `New review-ready leads: ${leads.length}`,
    "Tap **✅ Approve & WhatsApp** to record APPROVED and open WhatsApp with the draft prefilled.",
    "After the message is actually sent, tap **📌 Mark CONTACTED**."
  ].join("\n");

  const items = leads.map(lineFor);
  const chunks = chunkMessages(header, items);

  for (const chunk of chunks) {
    await sendDiscord(webhookUrl, chunk);
  }

  markDiscordNotified(leads.map((lead) => lead.id));

  logActivity("DISCORD_NOTIFY", {
    leadCount: leads.length,
    messageCount: chunks.length,
    whatsappPrefillEnabled: true,
    approvalTrackingEnabled: true
  });

  console.log(`Sent ${leads.length} NEW review-ready leads to Discord in ${chunks.length} message(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
