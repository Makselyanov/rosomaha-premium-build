import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const baseUrl = "https://xn--80aa8ahaki9a.site";
const today = new Date().toISOString().slice(0, 10);

function unique(values) {
  return [...new Set(values)];
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, `${content.trim()}\n`, "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function buildUrlSet(routes) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const route of routes) {
    lines.push("  <url>");
    lines.push(`    <loc>${baseUrl}${route.path === "/" ? "/" : route.path}</loc>`);
    lines.push(`    <lastmod>${route.lastmod || today}</lastmod>`);
    lines.push(`    <changefreq>${route.changefreq}</changefreq>`);
    lines.push(`    <priority>${route.priority}</priority>`);
    lines.push("  </url>");
  }

  lines.push("</urlset>");
  return lines.join("\n");
}

function buildSitemapIndex(files) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const file of files) {
    lines.push("  <sitemap>");
    lines.push(`    <loc>${baseUrl}/${file}</loc>`);
    lines.push(`    <lastmod>${today}</lastmod>`);
    lines.push("  </sitemap>");
  }

  lines.push("</sitemapindex>");
  return lines.join("\n");
}

function parseArticleRoutes() {
  const articlesPath = path.join(publicDir, "api", "articles.json");
  const articles = JSON.parse(readText(articlesPath));

  return articles.map((article) => ({
    path: `/articles/${article.slug}`,
    changefreq: "monthly",
    priority: "0.7",
    lastmod: today,
  }));
}

function parseApplicationRoutes() {
  const source = readText(path.join(rootDir, "src", "data", "applications.ts"));
  const matches = [...source.matchAll(/slug:\s*'([^']+)'/g)];

  return unique(matches.map((match) => match[1])).map((slug) => ({
    path: `/applications/${slug}`,
    changefreq: "monthly",
    priority: "0.7",
    lastmod: today,
  }));
}

function parseModelRoutes() {
  const source = readText(path.join(rootDir, "src", "data", "products.ts"));
  const productsStart = source.indexOf("export const products: Product[] = [");
  const productsSource = productsStart === -1 ? source : source.slice(productsStart);
  const matches = [...productsSource.matchAll(/^\s{4}slug:\s*'([^']+)'/gm)];

  return unique(matches.map((match) => match[1])).map((slug) => ({
    path: `/catalog/${slug}`,
    changefreq: "monthly",
    priority: "0.8",
    lastmod: today,
  }));
}

const staticRoutes = [
  { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
  { path: "/catalog", changefreq: "weekly", priority: "0.9", lastmod: today },
  { path: "/options", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/articles", changefreq: "weekly", priority: "0.9", lastmod: today },
  { path: "/media", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/applications", changefreq: "weekly", priority: "0.8", lastmod: today },
  { path: "/company", changefreq: "monthly", priority: "0.8", lastmod: today },
  { path: "/dealers", changefreq: "monthly", priority: "0.7", lastmod: today },
  { path: "/dealers/tyumen", changefreq: "monthly", priority: "0.8", lastmod: today },
  { path: "/contacts", changefreq: "monthly", priority: "0.7", lastmod: today },
  { path: "/delivery", changefreq: "monthly", priority: "0.7", lastmod: today },
  { path: "/order", changefreq: "monthly", priority: "0.7", lastmod: today },
  { path: "/politika-konfidencialnosti", changefreq: "yearly", priority: "0.4", lastmod: today },
];

const sitemapFiles = [
  "sitemap.xml",
  "sitemap-models.xml",
  "sitemap-applications.xml",
  "sitemap-articles.xml",
];

writeFile(path.join(publicDir, "sitemap.xml"), buildUrlSet(staticRoutes));
writeFile(path.join(publicDir, "sitemap-models.xml"), buildUrlSet(parseModelRoutes()));
writeFile(path.join(publicDir, "sitemap-applications.xml"), buildUrlSet(parseApplicationRoutes()));
writeFile(path.join(publicDir, "sitemap-articles.xml"), buildUrlSet(parseArticleRoutes()));
writeFile(path.join(publicDir, "sitemap-index.xml"), buildSitemapIndex(sitemapFiles));
