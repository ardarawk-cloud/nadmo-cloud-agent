const USER_AGENT = "NADMO-Cloud-Agent/0.11.1 (local-business discovery)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
let lastOverpassRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceOverpass(minGapMs = 2500) {
  const elapsed = Date.now() - lastOverpassRequestAt;
  if (elapsed < minGapMs) await sleep(minGapMs - elapsed);
  lastOverpassRequestAt = Date.now();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function osmUrl(element) {
  const type = element.type === "relation" ? "relation" : element.type === "way" ? "way" : "node";
  return `https://www.openstreetmap.org/${type}/${element.id}`;
}

function first(tags, keys) {
  for (const key of keys) {
    const value = tags?.[key];
    if (value) return String(value).trim();
  }
  return null;
}

function buildFilters(category) {
  const c = category.toLowerCase();
  if (/makeup|make-up|mua/.test(c)) {
    return [
      '["beauty"="makeup"]',
      '["name"~"makeup|make-up|mua|make up",i]'
    ];
  }
  if (/salon|beauty|hair/.test(c)) {
    return ['["shop"="beauty"]', '["shop"="hairdresser"]'];
  }
  if (/guest|hotel|villa|homestay|resort|hostel/.test(c)) {
    return [
      '["tourism"="guest_house"]',
      '["tourism"="hotel"]',
      '["tourism"="hostel"]',
      '["tourism"="resort"]'
    ];
  }
  if (/restaurant|cafe|coffee|food/.test(c)) {
    return ['["amenity"="restaurant"]', '["amenity"="cafe"]'];
  }
  if (/laundry/.test(c)) {
    return ['["shop"="laundry"]'];
  }
  if (/barber/.test(c)) {
    return ['["shop"="hairdresser"]'];
  }
  if (/gym|fitness/.test(c)) {
    return ['["leisure"="fitness_centre"]'];
  }
  if (/dentist|dental/.test(c)) {
    return ['["amenity"="dentist"]'];
  }
  if (/car rental|rent car|rental car/.test(c)) {
    return ['["amenity"="car_rental"]'];
  }
  if (/tattoo/.test(c)) {
    return ['["shop"="tattoo"]'];
  }
  const safe = escapeRegex(category.trim());
  return [`["name"~"${safe}",i]`];
}

async function geocode(location) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", location);

  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error(`Location not found: ${location}`);

  const [south, north, west, east] = data[0].boundingbox.map(Number);
  return { south, west, north, east, displayName: data[0].display_name };
}

async function overpass(bbox, filters) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const clauses = filters.flatMap((filter) => [
    `node${filter}(${box});`,
    `way${filter}(${box});`,
    `relation${filter}(${box});`
  ]).join("\n");

  const query = `[out:json][timeout:35];(\n${clauses}\n);out center tags 200;`;
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await paceOverpass();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);

        let response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "User-Agent": USER_AGENT,
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: new URLSearchParams({ data: query }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }

        if (response.ok) {
          const data = await response.json();
          return Array.isArray(data.elements) ? data.elements : [];
        }

        lastError = new Error(`Overpass HTTP ${response.status}`);

        if (!RETRYABLE_HTTP.has(response.status)) {
          throw lastError;
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < 3) {
        await sleep(3000 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Overpass request failed");
}

function matchesCategory(element, category) {
  const tags = element.tags ?? {};
  const c = category.toLowerCase();
  const name = String(tags.name ?? tags.brand ?? tags.operator ?? "").toLowerCase();

  if (/makeup|make-up|mua/.test(c)) {
    return tags.beauty === "makeup" || /makeup|make-up|make up|\bmua\b/i.test(name);
  }

  if (/salon|beauty|hair/.test(c)) {
    return tags.shop === "beauty" || tags.shop === "hairdresser";
  }

  if (/guest|hotel|villa|homestay|resort|hostel/.test(c)) {
    return ["guest_house", "hotel", "hostel", "resort"].includes(tags.tourism);
  }

  if (/restaurant|cafe|coffee|food/.test(c)) {
    return ["restaurant", "cafe"].includes(tags.amenity);
  }
  if (/laundry/.test(c)) return tags.shop === "laundry";
  if (/barber/.test(c)) return tags.shop === "hairdresser";
  if (/gym|fitness/.test(c)) return tags.leisure === "fitness_centre";
  if (/dentist|dental/.test(c)) return tags.amenity === "dentist";
  if (/car rental|rent car|rental car/.test(c)) return tags.amenity === "car_rental";
  if (/tattoo/.test(c)) return tags.shop === "tattoo";

  return name.includes(c.trim());
}

function normalizeElement(element, locationLabel, category) {
  const tags = element.tags ?? {};
  const name = first(tags, ["name", "brand", "operator"]);
  if (!name) return null;
  if (!matchesCategory(element, category)) return null;

  const website = first(tags, ["website", "contact:website", "url"]);
  const instagram = first(tags, ["contact:instagram", "instagram"]);
  const phone = first(tags, ["contact:phone", "phone", "mobile", "contact:mobile"]);
  const email = first(tags, ["contact:email", "email"]);

  return {
    name,
    sourceUrl: website || osmUrl(element),
    pageTitle: `OpenStreetMap local discovery • ${locationLabel}`,
    phone,
    email,
    instagram,
    status: website ? "DISCOVERED_HAS_WEBSITE" : "DISCOVERED_NO_WEBSITE"
  };
}

export async function discoverLocalBusinesses(location, category, limit = 10) {
  const bbox = await geocode(location);
  const filters = buildFilters(category);
  const elements = await overpass(bbox, filters);

  const seen = new Set();
  const results = [];

  for (const element of elements) {
    const item = normalizeElement(element, bbox.displayName, category);
    if (!item) continue;
    const key = `${item.name.toLowerCase()}|${item.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= limit) break;
  }

  return { location: bbox.displayName, results };
}
