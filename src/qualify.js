function isDiscoveryLead(lead) {
  return lead.status === "DISCOVERED_HAS_WEBSITE" ||
    lead.status === "DISCOVERED_NO_WEBSITE";
}

function hasWebsite(lead) {
  return lead.status === "DISCOVERED_HAS_WEBSITE";
}

function hasAnyContact(lead) {
  return Boolean(lead.phone || lead.email || lead.instagram);
}

export function qualifyLead(lead) {
  if (!isDiscoveryLead(lead)) return null;

  let score = 0;
  const reasons = [];
  const websiteListed = hasWebsite(lead);
  const contactAvailable = hasAnyContact(lead);

  if (!websiteListed) {
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

  if (!websiteListed && contactAvailable) {
    recommendation = "ACTIONABLE_VERIFY";
  } else if (!websiteListed && !contactAvailable) {
    recommendation = "RESEARCH_NEEDED";
  } else if (websiteListed) {
    recommendation = "HAS_WEBSITE";
  }

  return {
    ...lead,
    score,
    recommendation,
    actionable: recommendation === "ACTIONABLE_VERIFY",
    reasons
  };
}

export function rankLeads(leads) {
  return leads
    .map(qualifyLead)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
      return b.score - a.score || a.name.localeCompare(b.name);
    });
}
