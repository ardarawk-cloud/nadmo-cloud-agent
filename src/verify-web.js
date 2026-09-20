import { chromium } from "playwright";

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
  "openstreetmap.org",
  "waze.com",
  "wanderlog.com",
  "mapcarta.com",
  "restaurantguru.com",
  "restaurantguru.co.id",
  "top-rated.online",
  "zaubee.com",
  "nicelocal.id",
  "cybo.com",
  "business.site",
  "bali.com",
  "bali.live",
  "kuta.co.id",
  "latihanfisik.com",
  "rentberry.com",
  "nomadfit.app"
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
  "beauty", "official", "website", "indonesia",
  "the", "road", "street", "jalan", "jl"
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

function brandAcronyms(name) {
  const words = normalize(name)
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !["the", "and", "of"].includes(word));

  const acronyms = new Set();
  if (words.length >= 2) acronyms.add(words.map((word) => word[0]).join(""));
  const distinctive = distinctiveTokens(name);
  if (distinctive.length >= 2) acronyms.add(distinctive.map((word) => word[0]).join(""));
  return [...acronyms].filter((value) => value.length >= 3);
}

function isSocialPostUrl(link) {
  try {
    const url = new URL(link);
    const path = url.pathname.toLowerCase();
    return /\/(p|posts|photos|reel|reels|videos|watch)\//.test(path);
  } catch {
    return true;
  }
}

function socialPathMatchesBrand(name, link) {
  try {
    const url = new URL(link);
    const path = url.pathname.toLowerCase();
    const compactPath = path.replace(/[^a-z0-9]/g, "");
    const tokens = distinctiveTokens(name);

    if (tokens.length > 0) {
      const compactBrand = tokens.join("");
      if (compactBrand.length >= 3 && compactPath.includes(compactBrand)) return true;

      const matched = tokens.filter((token) => compactPath.includes(token)).length;
      if (tokens.length === 1 && matched === 1) return true;
      if (tokens.length > 1 && matched / tokens.length >= 0.5) return true;
    }

    return brandAcronyms(name).some((acronym) => compactPath.includes(acronym));
  } catch {
    return false;
  }
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

async function extractExternalCandidates(result, lead) {
  if (!result?.link) return [];
  if (!textMatchesBrand(lead.name, result.title) || !phoneMatches(lead, result)) {
    return [];
  }

  let html = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(result.link, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
        }
      });
      if (response.ok) html = await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }

  const found = new Set();

  for (const match of html.matchAll(/href=["'](https?:\/\/[^"'#\s]+)["']/gi)) {
    try {
      const url = new URL(match[1]);
      if (isDirectory(url.href) || isSocial(url.href)) continue;
      found.add(url.origin);
    } catch {}
  }

  for (const match of html.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const host = match[1].toLowerCase();
    if (hostMatches(host, ["gmail.com","yahoo.com","hotmail.com","outlook.com"])) continue;
    found.add(`https://${host}`);
  }

  return [...found].map((link) => ({
    link,
    title: result.title,
    snippet: result.snippet,
    sourceType: "directory_evidence"
  }));
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

    if (response.status >= 200 && response.status < 400) {
      return {
        ok: true,
        finalUrl: response.url || url,
        status: response.status,
        checkedBy: "fetch"
      };
    }
  } catch {
    // Fall through to a real browser check. Some sites block plain HTTP clients.
  } finally {
    clearTimeout(timer);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 12000
    });

    const status = response?.status() ?? null;
    return {
      ok: Boolean(response && status >= 200 && status < 400),
      finalUrl: page.url() || url,
      status,
      checkedBy: "playwright"
    };
  } catch {
    return {
      ok: false,
      finalUrl: url,
      status: null,
      checkedBy: "playwright"
    };
  } finally {
    if (browser) await browser.close();
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
        snippet: data.knowledgeGraph.description ?? "",
        sourceType: "knowledge_graph"
      });
    }

    if (Array.isArray(data.organic)) {
      results.push(...data.organic.map((result) => ({
        ...result,
        sourceType: "organic"
      })));
    }
  }

  const evidenceResults = results.filter(
    (result) => isDirectory(result.link) && textMatchesBrand(lead.name, result.title) && phoneMatches(lead, result)
  );

  for (const evidence of evidenceResults.slice(0, 3)) {
    const extracted = await extractExternalCandidates(evidence, lead);
    results.push(...extracted);
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
    .map((result) => ({
      ...result,
      score: resultScore(lead, result),
      brandTitleMatch: textMatchesBrand(lead.name, result.title),
      matchedPhone: phoneMatches(lead, result),
      socialPathMatch: socialPathMatchesBrand(lead.name, result.link)
    }))
    .filter((result) =>
      (
        !isSocialPostUrl(result.link) &&
        result.brandTitleMatch &&
        result.socialPathMatch
      ) ||
      (
        !isSocialPostUrl(result.link) &&
        result.matchedPhone &&
        result.brandTitleMatch
      ) ||
      (
        result.sourceType === "knowledge_graph" &&
        result.brandTitleMatch
      )
    )
    .sort((a, b) => b.score - a.score)[0] ?? null;

  const websiteCandidates = uniqueResults
    .filter((result) => !isSocial(result.link) && !isDirectory(result.link))
    .map((result) => ({
      ...result,
      score: resultScore(lead, result),
      brandDomainMatch: domainMatchesBrand(lead.name, result.link),
      brandTitleMatch: textMatchesBrand(lead.name, result.title),
      matchedPhone: phoneMatches(lead, result),
      officialSignal:
        domainMatchesBrand(lead.name, result.link) ||
        (
          result.sourceType === "directory_evidence" &&
          textMatchesBrand(lead.name, result.title)
        ) ||
        (
          result.sourceType === "knowledge_graph" &&
          textMatchesBrand(lead.name, result.title)
        )
    }))
    .filter((result) => result.score >= 5)
    .sort((a, b) => b.score - a.score);

  const officialCandidates = websiteCandidates.filter(
    (candidate) => candidate.officialSignal
  );

  for (const candidate of officialCandidates.slice(0, 3)) {
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

  const deadSiteCandidate = officialCandidates.find(
    (candidate) =>
      candidate.brandDomainMatch ||
      (
        candidate.sourceType === "knowledge_graph" &&
        candidate.brandTitleMatch
      )
  );

  if (deadSiteCandidate) {
    return {
      leadId: lead.id,
      verdict: "DEAD_WEBSITE",
      officialUrl: deadSiteCandidate.link,
      evidenceTitle: deadSiteCandidate.title ?? null,
      evidenceSnippet: deadSiteCandidate.snippet ?? null
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
