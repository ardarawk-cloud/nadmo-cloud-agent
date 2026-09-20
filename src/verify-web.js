const BLOCKED_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "tripadvisor.com",
  "trip.com",
  "traveloka.com",
  "booking.com",
  "agoda.com",
  "expedia.com",
  "hotels.com",
  "airbnb.com",
  "foursquare.com",
  "yelp.com",
  "trustpilot.com",
  "yellowpages.com",
  "aibiz.id",
  "indonetwork.co.id",
  "kumparan.com",
  "detik.com",
  "kompas.com",
  "google.com",
  "maps.google.com",
  "openstreetmap.org",
  "x.com"
];

const GENERIC_TOKENS = new Set([
  "bali", "denpasar", "clinic", "spa", "salon", "studio", "restaurant",
  "cafe", "coffee", "hotel", "villa", "guest", "house", "makeup", "artist",
  "beauty", "official", "website", "indonesia"
]);

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

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function distinctiveTokens(name) {
  return normalize(name)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
}

function domainMatchesBrand(name, link) {
  const host = hostnameOf(link)
    .replace(/\.(com|co\.id|id|net|org|co|biz|info|asia)$/i, "");
  const compactHost = host.replace(/[^a-z0-9]/g, "");
  const tokens = distinctiveTokens(name);

  if (tokens.length === 0) return false;

  const compactBrand = tokens.join("");
  if (compactBrand.length >= 3 && compactHost.includes(compactBrand)) return true;

  const matched = tokens.filter((token) => compactHost.includes(token)).length;
  if (tokens.length === 1) return matched === 1;
  return matched / tokens.length >= 0.5;
}

function titleMatchesBrand(name, title) {
  const titleNorm = normalize(title);
  const tokens = distinctiveTokens(name);
  if (tokens.length === 0) return false;
  const matched = tokens.filter((token) => titleNorm.includes(token)).length;
  return tokens.length === 1 ? matched === 1 : matched / tokens.length >= 0.5;
}

function phoneMatches(lead, result) {
  const phone = digits(lead.phone);
  if (phone.length < 7) return false;
  const haystack = digits(`${result.title ?? ""} ${result.snippet ?? ""}`);
  const tail = phone.slice(-8);
  return tail.length >= 7 && haystack.includes(tail);
}

function resultScore(lead, result) {
  let score = 0;
  if (domainMatchesBrand(lead.name, result.link)) score += 5;
  if (titleMatchesBrand(lead.name, result.title)) score += 3;
  if (phoneMatches(lead, result)) score += 6;

  const haystack = normalize(`${result.title ?? ""} ${result.snippet ?? ""}`);
  if (haystack.includes("bali") || haystack.includes("denpasar")) score += 1;

  return score;
}

async function serperSearch(apiKey, q) {
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

  return response.json();
}

export async function verifyLeadOnWeb(lead, apiKey) {
  if (!apiKey) throw new Error("SERPER_API_KEY is missing.");

  const queries = [
    `"${lead.name}" Bali`,
    `${lead.name} Bali website`
  ];

  if (lead.phone) {
    queries.push(`"${lead.phone}"`);
  }

  const results = [];

  for (const q of queries) {
    const data = await serperSearch(apiKey, q);

    if (data?.knowledgeGraph?.website) {
      results.push({
        link: data.knowledgeGraph.website,
        title: data.knowledgeGraph.title ?? lead.name,
        snippet: data.knowledgeGraph.description ?? ""
      });
    }

    if (Array.isArray(data.organic)) {
      results.push(...data.organic);
    }
  }

  const seen = new Set();
  const candidates = results
    .filter((result) => result?.link && !blocked(result.link))
    .filter((result) => {
      const key = result.link;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((result) => ({
      ...result,
      score: resultScore(lead, result)
    }))
    .filter((result) => result.score >= 5)
    .sort((a, b) => b.score - a.score);

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
    verdict: "NO_OFFICIAL_SITE_FOUND",
    officialUrl: null,
    evidenceTitle: null,
    evidenceSnippet: null
  };
}
