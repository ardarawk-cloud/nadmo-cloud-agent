import { chromium } from "playwright";
import { config } from "./config.js";

function normalizeResultHref(href) {
  if (!href) return null;
  try {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    const url = new URL(absolute);
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")) {
      const target = url.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    if (["http:", "https:"].includes(url.protocol)) return url.toString();
  } catch {
    return null;
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export async function discoverUrls(query, limit = 10) {
  if (!query?.trim()) throw new Error("Discovery query is required.");
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    });
    page.setDefaultTimeout(config.browserTimeoutMs);
    const searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query.trim());
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: config.browserTimeoutMs });
    const hrefs = await page.locator("a.result__a").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href"))
    );
    return unique(hrefs.map(normalizeResultHref)).slice(0, limit);
  } finally {
    await browser.close();
  }
}
