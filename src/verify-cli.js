const BLOCKED_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "tripadvisor.com",
  "traveloka.com",
  "booking.com",
  "agoda.com",
  "google.com",
  "maps.google.com",
  "openstreetmap.org",
  "x.com"
];

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function blocked(url) {
  const host = hostnameOf(url);
  return BLOCKED_HOSTS.some((domain) => host === domain || host.endsWith("." + domain));
}

function tokens(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function relevanceScore(name, result) {
  const haystack = `${result.title ?? ""} ${result.snippet ?? ""} ${result.link ?? ""}`.toLowerCase();
  const ts = tokens(name);
  if (ts.length === 0) return 0;
  const matched = ts.filter((t) => haystack.includes(t)).length;
  return matched / ts.length;
}

export async function verifyLeadOnWeb(lead, apiKey) {
  if (!apiKey) throw new Error("SERPER_API_KEY is missing.");

  const q = `"${lead.name}" Bali official website`;
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q,
      gl: "id",
      hl: "en",
      num: 10
    })
  });

  if (!response.ok) {
    throw new Error(`Serper HTTP ${response.status}`);
  }

  const data = await response.json();
  const organic = Array.isArray(data.organic) ? data.organic : [];

  const candidates = organic
    .filter((result) => result?.link && !blocked(result.link))
    .map((result) => ({
      ...result,
      relevance: relevanceScore(lead.name, result)
    }))
    .filter((result) => result.relevance >= 0.6)
    .sort((a, b) => b.relevance - a.relevance);

  const best = candidates[0] ?? null;

  if (best) {
    return {
      leadId: lead.id,
      verdict: "HAS_WEBSITE",
      officialUrl: best.link,
      evidenceTitle: best.title ?? null,
      evidenceSnippet: best.snippet ?? null
    };
  }

  return {
    leadId: lead.id,
    verdict: "POTENTIAL_LEAD",
    officialUrl: null,
    evidenceTitle: null,
    evidenceSnippet: null
  };
}
