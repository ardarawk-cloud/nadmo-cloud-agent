const USER_AGENT = "NADMO-Cloud-Agent/0.2 (local-business discovery)";

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

  const query = `[out:json][timeout:25];(\n${clauses}\n);out center tags;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({ data: query })
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.elements) ? data.elements : [];
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
