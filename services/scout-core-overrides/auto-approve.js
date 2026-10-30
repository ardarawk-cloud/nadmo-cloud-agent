import "dotenv/config";
import { config } from "../../src/config.js";
import { closeDb, listReviewLeads, logActivity } from "../../src/db.js";

function normalizeWhatsappMobile(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith("628") || digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function routeFor(lead) {
  const wa = normalizeWhatsappMobile(lead.phone);
  if (wa) return { channel: "WHATSAPP", phone: wa };
  if (lead.email) return { channel: "EMAIL", phone: "" };
  if (lead.instagram) return { channel: "INSTAGRAM", phone: "" };
  if (lead.phone) return { channel: "PHONE_MANUAL", phone: lead.phone };
  return { channel: "MANUAL", phone: "" };
}

async function approve(base, lead, route) {
  const params = new URLSearchParams({
    leadId: String(lead.id),
    name: lead.name || "Lead",
    status: "APPROVED",
    dry: "1"
  });
  if (route.phone) params.set("phone", route.phone);

  const response = await fetch(`${base}/api/stage?${params.toString()}`, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`gateway HTTP ${response.status}: ${body.slice(0, 160)}`);
  }
}

async function main() {
  if (String(process.env.SCOUT_AUTO_APPROVE || "").toLowerCase() !== "true") {
    console.log("Scout auto-approve disabled.");
    return;
  }

  const base = config.approvalGatewayBaseUrl.replace(/\/+$/, "");
  const leads = listReviewLeads().filter((lead) => {
    const status = lead.outreachStatus || "REVIEW_PENDING";
    return status === "REVIEW_PENDING";
  }).slice(0, 20);

  let approved = 0;
  const routed = {};

  for (const lead of leads) {
    const route = routeFor(lead);
    if (route.channel === "MANUAL") continue;

    try {
      await approve(base, lead, route);
      approved += 1;
      routed[route.channel] = (routed[route.channel] || 0) + 1;
      logActivity("AUTO_APPROVED", {
        leadId: lead.id,
        name: lead.name,
        verdict: lead.verdict,
        route: route.channel
      });
      console.log(`AUTO_APPROVED lead=${lead.id} route=${route.channel} name=${lead.name}`);
    } catch (error) {
      console.error(`AUTO_APPROVE_FAILED lead=${lead.id}: ${error.message}`);
      logActivity("AUTO_APPROVE_ERROR", {
        leadId: lead.id,
        name: lead.name,
        error: error.message
      });
    }
  }

  console.log("Scout auto-approve summary:", { approved, routed });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
