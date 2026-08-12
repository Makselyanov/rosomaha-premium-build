import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const expectedOrigin = "https://xn--80aa8ahaki9a.site";
const approvedModelPrices = [
  ["rosomaha-standart-plus", "от 1 350 000 ₽", "от 1 300 000 ₽", 1350000],
  ["rosomaha-standart-plus-uaz", "от 1 450 000 ₽", "от 1 400 000 ₽", 1450000],
  ["rosomaha-extrime-uaz", "от 1 850 000 ₽", "от 1 800 000 ₽", 1850000],
  ["rosomaha-extrime-toyota", "от 2 100 000 ₽", "от 2 050 000 ₽", 2100000],
  ["rosomaha-extrime-plus", "от 2 200 000 ₽", "от 2 150 000 ₽", 2200000],
  ["rosomaha-hunter", "от 2 230 000 ₽", "от 2 180 000 ₽", 2230000],
  ["rosomaha-pickup-uaz-timken", "от 1 850 000 ₽", "от 1 800 000 ₽", 1850000],
  ["rosomaha-pickup-uaz-18", "от 2 300 000 ₽", "от 2 250 000 ₽", 2300000],
  ["rosomaha-pickup-toyota", "от 2 500 000 ₽", "от 2 450 000 ₽", 2500000],
];

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sitemapLocations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

function routeFile(url) {
  const pathname = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return pathname
    ? path.join(distDir, ...pathname.split("/"), "index.html")
    : path.join(distDir, "index.html");
}

function extract(html, pattern) {
  return html.match(pattern)?.[1]?.trim() || "";
}

function count(html, pattern) {
  return [...html.matchAll(pattern)].length;
}

function plainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|quot|#39);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findSchemaByType(value, type) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSchemaByType(entry, type);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  if (value["@type"] === type || (Array.isArray(value["@type"]) && value["@type"].includes(type))) {
    return value;
  }

  for (const entry of Object.values(value)) {
    const found = findSchemaByType(entry, type);
    if (found) return found;
  }
  return null;
}

if (!fs.existsSync(path.join(distDir, "sitemap-index.xml"))) {
  throw new Error("dist is missing; run npm run build first");
}

const sitemapIndex = read(path.join(distDir, "sitemap-index.xml"));
const sitemapFiles = sitemapLocations(sitemapIndex).map((url) => path.basename(new URL(url).pathname));
const urls = sitemapFiles.flatMap((fileName) => sitemapLocations(read(path.join(distDir, fileName))));
const uniqueUrls = [...new Set(urls)];
const failures = [];
const catalogProductCount = uniqueUrls.filter((url) => new URL(url).pathname.startsWith("/catalog/")).length;

for (const url of uniqueUrls) {
  if (new URL(url).origin !== expectedOrigin) {
    failures.push(`${url}: sitemap URL must use ${expectedOrigin}`);
  }

  const filePath = routeFile(url);
  if (!fs.existsSync(filePath)) {
    failures.push(`${url}: missing ${path.relative(rootDir, filePath)}`);
    continue;
  }

  const html = read(filePath);
  const title = extract(html, /<title>([\s\S]*?)<\/title>/i);
  const description = extract(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  const canonical = extract(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
  const staticBody = extract(html, /<main[^>]+id="seo-prerender"[^>]*>([\s\S]*?)<\/main>/i);
  const h1Count = count(staticBody, /<h1[\s>]/gi);
  const linkCount = count(staticBody, /<a\s[^>]*href=/gi);

  if (!title) failures.push(`${url}: missing title`);
  if (!description) failures.push(`${url}: missing description`);
  if (canonical !== url) failures.push(`${url}: canonical=${canonical || "missing"}`);
  if (canonical && new URL(canonical).origin !== expectedOrigin) {
    failures.push(`${url}: canonical must use ${expectedOrigin}`);
  }
  if (!staticBody) failures.push(`${url}: missing static prerender body`);
  if (h1Count !== 1) failures.push(`${url}: expected one static H1, got ${h1Count}`);
  if (linkCount < 3) failures.push(`${url}: expected at least three crawlable links, got ${linkCount}`);
  if (plainText(staticBody).length < 150) failures.push(`${url}: static body is too thin`);
  if (/__SEO_[A-Z_]+__/.test(html)) failures.push(`${url}: unresolved SEO placeholder`);
}

const homeHtml = read(path.join(distDir, "index.html"));
const catalogHtml = read(path.join(distDir, "catalog", "index.html"));
const homeTitle = extract(homeHtml, /<title>([\s\S]*?)<\/title>/i);
const homeH1 = extract(homeHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
const catalogTitle = extract(catalogHtml, /<title>([\s\S]*?)<\/title>/i);
const catalogH1 = extract(catalogHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i);

for (const [label, value] of [["home title", homeTitle], ["home H1", homeH1], ["catalog title", catalogTitle], ["catalog H1", catalogH1]]) {
  if (!/квадроциклы?-вездеходы?/i.test(value)) failures.push(`${label}: missing target phrase`);
}

if (homeHtml.includes("t.me/rosomahaclub") || homeHtml.includes("youtube.com/@Rosomaha_Club")) {
  failures.push("manufacturer Organization schema still conflates Rosomaha Club channels");
}

for (const [slug, expectedPrice, previousPrice, expectedNumericPrice] of approvedModelPrices) {
  const url = `${expectedOrigin}/catalog/${slug}`;
  const filePath = routeFile(url);

  if (!fs.existsSync(filePath)) {
    failures.push(`${url}: missing approved model route`);
    continue;
  }

  const html = read(filePath);
  const staticBody = extract(html, /<main[^>]+id="seo-prerender"[^>]*>([\s\S]*?)<\/main>/i);
  const visibleText = plainText(staticBody);
  const expectedLabel = `Цена: ${expectedPrice}`;
  const previousLabel = `Цена: ${previousPrice}`;
  const priceElementCount = count(staticBody, /<p[^>]+data-model-price(?:=["'][^"']*["'])?[^>]*>/gi);
  const expectedLabelCount = visibleText.split(expectedLabel).length - 1;
  const expectedPriceCount = html.split(expectedPrice).length - 1;
  const title = extract(html, /<title>([\s\S]*?)<\/title>/i);
  const description = extract(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  const canonical = extract(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
  const robots = extract(html, /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i);
  const ogTitle = extract(html, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i);
  const ogDescription = extract(html, /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i);
  const ogUrl = extract(html, /<meta[^>]+property="og:url"[^>]+content="([^"]*)"/i);

  if (priceElementCount !== 1) {
    failures.push(`${url}: expected one visible prerender price element, got ${priceElementCount}`);
  }
  if (expectedLabelCount !== 1) {
    failures.push(`${url}: expected one visible '${expectedLabel}', got ${expectedLabelCount}`);
  }
  if (expectedPriceCount !== 1) {
    failures.push(`${url}: expected one formatted price '${expectedPrice}' in HTML, got ${expectedPriceCount}`);
  }
  if (visibleText.includes(previousLabel)) {
    failures.push(`${url}: visible prerender still contains previous price '${previousLabel}'`);
  }
  if (html.includes(previousPrice)) {
    failures.push(`${url}: HTML still contains previous price '${previousPrice}'`);
  }
  if (!title || !description || ogTitle !== title || ogDescription !== description) {
    failures.push(`${url}: price update changed or removed title, description or OpenGraph metadata`);
  }
  if (canonical !== url || ogUrl !== url || robots !== "index,follow") {
    failures.push(`${url}: price update changed canonical, og:url or robots`);
  }

  const schemaText = extract(html, /<script[^>]+id="page-json-ld"[^>]*>([\s\S]*?)<\/script>/i);
  try {
    const schema = JSON.parse(schemaText);
    const product = findSchemaByType(schema, "Product");
    if (product?.offers?.price !== expectedNumericPrice) {
      failures.push(`${url}: Product JSON-LD price=${product?.offers?.price ?? "missing"}, expected ${expectedNumericPrice}`);
    }
  } catch (error) {
    failures.push(`${url}: Product JSON-LD is invalid JSON: ${error.message}`);
  }
}

const catalogSchemaText = extract(catalogHtml, /<script[^>]+id="page-json-ld"[^>]*>([\s\S]*?)<\/script>/i);
try {
  const catalogSchema = JSON.parse(catalogSchemaText);
  const offerCatalog = findSchemaByType(catalogSchema, "OfferCatalog");
  if (!offerCatalog || offerCatalog.itemListElement?.length !== catalogProductCount) {
    failures.push(`catalog schema: expected ${catalogProductCount} offers from the model sitemap, got ${offerCatalog?.itemListElement?.length ?? 0}`);
  }
} catch (error) {
  failures.push(`catalog schema is invalid JSON: ${error.message}`);
}

if (failures.length) {
  console.error(`SEO prerender audit failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`SEO prerender audit passed: ${uniqueUrls.length} canonical routes with crawlable HTML.`);
console.log(`Primary cluster: ${homeTitle} / ${catalogTitle}`);
console.log(`Origin: ${expectedOrigin}`);
