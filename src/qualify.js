function isDiscoveryLead(lead) {
  return lead.status === "DISCOVERED_HAS_WEBSITE" ||
    lead.status === "DISCOVERED_NO_WEBSITE";
}

function hasWebsite(lead) {
  return lead.status === "DISCOVERED_HAS_WEBSITE";
}

export function qualifyLead(lead) {
  if (!isDiscoveryLead(lead)) return null;

  let score = 0;
  const reasons = [];

  if (!hasWebsite(lead)) {
    score += 50;
    reasons.push("no website listed in discovery source");
  } else {
    reasons.push("website already listed");
  }

  if (lead.phone) {
    score += 25;
    reasons.push("public phone available");
  }

  if (lead.email) {
    score += 15;
    reasons.push("public email available");
  }

  if (lead.instagram) {
    score += 10;
    reasons.push("Instagram available");
  }

  let recommendation = "LOW_PRIORITY";
  if (score >= 70) recommendation = "STRONG_VERIFY";
  else if (score >= 50) recommendation = "VERIFY";

  return {
    ...lead,
    score,
    recommendation,
    reasons
  };
}

export function rankLeads(leads) {
  return leads
    .map(qualifyLead)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
