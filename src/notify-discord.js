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

function normalizeWhatsappMobile(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;

  if (!digits.startsWith("628") || digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
}

function whatsappUrl(phone) {
  const digits = normalizeWhatsappMobile(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

function gatewayBase() {
  return config.approvalGatewayBaseUrl.replace(/\/+$/, "");
}

function approveWhatsappUrl(lead, draft) {
  if (!normalizeWhatsappMobile(lead.phone)) return null;

  const params = new URLSearchParams({
    leadId: String(lead.id),
    name: lead.name || "Lead",
    phone: lead.phone,
    text: draft
  });

  params.set("bridge", "approve");
  return `${gatewayBase()}/?${params.toString()}`;
}

function stageUrl(lead, status) {
  const params = new URLSearchParams({
    leadId: String(lead.id),
    name: lead.name || "Lead",
    status
  });

  if (lead.phone) params.set("phone", lead.phone);
  params.set("bridge", "stage");
  return `${gatewayBase()}/?${params.toString()}`;
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
  const approveUrl = approveWhatsappUrl(lead, draft);
  const contactedUrl = stageUrl(lead, "CONTACTED");
  const repliedUrl = stageUrl(lead, "REPLIED");
  const interestedUrl = stageUrl(lead, "INTERESTED");
  const proposalUrl = stageUrl(lead, "PROPOSAL");
  const wonUrl = stageUrl(lead, "WON");
  const lostUrl = stageUrl(lead, "LOST");

  const contacts = [
    lead.phone
      ? wa
        ? `Phone: ${lead.phone}`
        : `Phone: ${lead.phone} (phone only — WhatsApp not detected)`
      : null,
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
    approveUrl
      ? `**Action:** [✅ Approve & WhatsApp](${approveUrl})`
      : lead.phone
        ? "**Action:** ☎️ Phone only — call manually."
        : null,
    `**After outreach:** [📌 CONTACTED](${contactedUrl})`,
    `**Pipeline:** [💬 REPLIED](${repliedUrl}) · [🔥 INTERESTED](${interestedUrl}) · [📄 PROPOSAL](${proposalUrl}) · [🏆 WON](${wonUrl}) · [❌ LOST](${lostUrl})`
  ].filter(Boolean).join("\n");
}

function chunkMessages(header, items, max = 1900) {
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
    "**NADMO Scout — Sales Pipeline Lead**",
    `New review-ready leads: ${leads.length}`,
    "Approve outreach, then update the pipeline stage directly from Discord."
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
    pipelineTrackingEnabled: true
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
