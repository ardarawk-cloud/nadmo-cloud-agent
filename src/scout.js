import { chromium } from "playwright";
import { config } from "./config.js";

const firstMatch = (items = []) => items.find(Boolean) ?? null;

function normalizeUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http/https URLs are allowed.");
  }
  return url.toString();
}

export async function inspectUrl(rawUrl) {
  const sourceUrl = normalizeUrl(rawUrl);
  const browser = await chromium.launch({ headless: config.headless });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(config.browserTimeoutMs);

    await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.browserTimeoutMs
    });

    const result = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll("a[href]")];
      const hrefs = anchors
        .map((a) => a.href)
        .filter(Boolean);

      const tel = hrefs.find((href) => href.startsWith("tel:")) ?? null;
      const mail = hrefs.find((href) => href.startsWith("mailto:")) ?? null;
      const instagram = hrefs.find((href) =>
        /^https?:\/\/(www\.)?instagram\.com\//i.test(href)
      ) ?? null;

      return {
        name:
          document.querySelector("h1")?.textContent?.trim() ||
          document.title?.trim() ||
          null,
        pageTitle: document.title?.trim() || null,
        phone: tel ? tel.replace(/^tel:/i, "").trim() : null,
        email: mail
          ? mail.replace(/^mailto:/i, "").split("?")[0].trim()
          : null,
        instagram
      };
    });

    return {
      ...result,
      sourceUrl,
      phone: firstMatch([result.phone]),
      email: firstMatch([result.email]),
      instagram: firstMatch([result.instagram]),
      status: "INSPECTED"
    };
  } finally {
    await browser.close();
  }
}
