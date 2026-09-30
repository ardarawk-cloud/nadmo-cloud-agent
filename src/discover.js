import { chromium } from "playwright";
import { config } from "./config.js";

const BLOCKED_HOSTS = new Set([
  "duckduckgo.com",
  "html.duckduckgo.com",
  "lite.duckduckgo.com",
  "www.bing.com",
  "bing.com",
  "go.microsoft.com"
]);

function normalizeResultHref(href, baseUrl) {
  if (!href) return null;
  try {
    const absolute = new URL(href, baseUrl);

    if (absolute.hostname.endsWith("duckduckgo.com")) {
      const target = absolute.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }

    if (!["http:", "https:"].includes(absolute.protocol)) return null;
    if (BLOCKED_HOSTS.has(absolute.hostname)) return null;
    return absolute.toString();
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function collectFromPage(page, searchUrl, selectors) {
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.browserTimeoutMs
  });

  for (const selector of selectors) {
    const hrefs = await page.locator(selector).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href"))
    );

    const urls = unique(
      hrefs.map((href) => normalizeResultHref(href, searchUrl))
    );

    if (urls.length > 0) return urls;
  }

  return [];
}

export async function discoverUrls(query, limit = 10) {
  if (!query?.trim()) throw new Error("Discovery query is required.");

  const browser = await chromium.launch({ headless: config.headless });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    });
    page.setDefaultTimeout(config.browserTimeoutMs);

    const q = encodeURIComponent(query.trim());
    const providers = [
      {
        name: "duckduckgo-html",
        url: `https://html.duckduckgo.com/html/?q=${q}`,
        selectors: ["a.result__a", "a[href*=\"uddg=\"]"]
      },
      {
        name: "duckduckgo-lite",
        url: `https://lite.duckduckgo.com/lite/?q=${q}`,
        selectors: ["a[href*=\"uddg=\"]", "a[href^=\"http\"]"]
      },
      {
        name: "bing",
        url: `https://www.bing.com/search?q=${q}`,
        selectors: ["li.b_algo h2 a", "h2 a[href^=\"http\"]"]
      }
    ];

    for (const provider of providers) {
      try {
        const urls = await collectFromPage(page, provider.url, provider.selectors);
        if (urls.length > 0) {
          console.log(`Discovery provider: ${provider.name}`);
          return urls.slice(0, limit);
        }
      } catch (error) {
        console.warn(`Discovery provider failed: ${provider.name} — ${error.message}`);
      }
    }

    console.warn("All discovery providers returned 0 candidate URLs.");
    return [];
  } finally {
    await browser.close();
  }
}
