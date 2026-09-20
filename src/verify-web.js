const DIRECTORY_HOSTS = [
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
  "openstreetmap.org"
];

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
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

function hostMatches(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith("." + domain));
}

function isDirectory(url) {
  return hostMatches(hostnameOf(url), DIRECTORY_HOSTS);
}

function isSocial(url) {
  return hostMatches(hostnameOf(url), SOCIAL_HOSTS);
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

function textMatchesBrand(name, text) {
  const textNorm = normalize(text);
  const tokens = distinctiveTokens(name);
  if (tokens.length === 0) return false;
  const matched = tokens.filter((token) => textNorm.includes(token)).length;
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
  if (textMatchesBrand(lead.name, result.title)) score += 3;
  if (textMatchesBrand(lead.name, result.snippet)) score += 2;
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

  if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
  return response.json();
}

async function websiteReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
      }
    });

    return {
      ok: response.status >= 200 && response.status < 400,
      finalUrl: response.url || url,
      status: response.status
    };
  } catch {
    return { ok: false, finalUrl: url, status: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyLeadOnWeb(lead, apiKey) {
  if (!apiKey) throw new Error("SERPER_API_KEY is missing.");

  const queries = [
    `"${lead.name}" Bali`,
    `${lead.name} Bali website`,
    `${lead.name} Bali Instagram`
  ];

  if (lead.phone) queries.push(`"${lead.phone}"`);

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

    if (Array.isArray(data.organic)) results.push(...data.organic);
  }

  const seen = new Set();
  const uniqueResults = results.filter((result) => {
    if (!result?.link) return false;
    if (seen.has(result.link)) return false;
    seen.add(result.link);
    return true;
  });

  const social = uniqueResults
    .filter((result) => isSocial(result.link))
    .map((result) => ({ ...result, score: resultScore(lead, result) }))
    .filter((result) => result.score >= 3)
    .sort((a, b) => b.score - a.score)[0] ?? null;

  const websiteCandidates = uniqueResults
    .filter((result) => !isSocial(result.link) && !isDirectory(result.link))
    .map((result) => ({ ...result, score: resultScore(lead, result) }))
    .filter((result) => result.score >= 5)
    .sort((a, b) => b.score - a.score);

  for (const candidate of websiteCandidates.slice(0, 3)) {
    const live = await websiteReachable(candidate.link);

    if (live.ok) {
      return {
        leadId: lead.id,
        verdict: "HAS_WEBSITE",
        officialUrl: live.finalUrl,
        evidenceTitle: candidate.title ?? null,
        evidenceSnippet: candidate.snippet ?? null
      };
    }
  }

  if (websiteCandidates.length > 0) {
    const candidate = websiteCandidates[0];
    return {
      leadId: lead.id,
      verdict: "DEAD_WEBSITE",
      officialUrl: candidate.link,
      evidenceTitle: candidate.title ?? null,
      evidenceSnippet: candidate.snippet ?? null
    };
  }

  if (social) {
    return {
      leadId: lead.id,
      verdict: "SOCIAL_ONLY",
      officialUrl: social.link,
      evidenceTitle: social.title ?? null,
      evidenceSnippet: social.snippet ?? null
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
