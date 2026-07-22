import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const utf8Decoder = new TextDecoder("utf-8");
const envPath = path.join(rootDir, ".env.seo.local");
const reportDir = path.join(rootDir, "seo-reports");
const reportPath = path.join(reportDir, "latest-yandex-webmaster-report.md");
const baseUrl = "https://xn--80aa8ahaki9a.site";
const articlesApiPath = path.join(rootDir, "public", "api", "articles.json");
const productsSourcePath = path.join(rootDir, "src", "data", "products.ts");

function parseEnvFile(filePath) {
  const env = {};

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

async function requestJson(url, token) {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `OAuth ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed ${response.status} for ${url}`);
    }

    return response.json();
  } catch (error) {
    const stdout = execFileSync(
      "curl.exe",
      ["-s", "-L", "-H", `Authorization: OAuth ${token}`, url],
      { encoding: "buffer" },
    );

    if (!stdout.length) {
      throw error;
    }

    return JSON.parse(utf8Decoder.decode(stdout));
  }
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Codex SEO Bot)",
      },
      redirect: "follow",
    });
    const html = await response.text();

    return {
      url,
      status: response.status,
      body: html,
    };
  } catch (error) {
    const headers = execFileSync(
      "curl.exe",
      ["-s", "-L", "-D", "-", "-o", "NUL", "-A", "Mozilla/5.0 (compatible; Codex SEO Bot)", url],
      { encoding: "buffer" },
    );
    const html = execFileSync(
      "curl.exe",
      ["-s", "-L", "-A", "Mozilla/5.0 (compatible; Codex SEO Bot)", url],
      { encoding: "buffer" },
    );
    const headerText = utf8Decoder.decode(headers);
    const bodyText = utf8Decoder.decode(html);
    const statusMatch = headerText.match(/HTTP\/\S+\s+(\d{3})/i);

    if (!bodyText.trim()) {
      throw error;
    }

    return {
      url,
      status: statusMatch ? Number(statusMatch[1]) : 0,
      body: bodyText,
    };
  }
}

function extractHeadSignals(html) {
  const patterns = {
    title: /<title>(.*?)<\/title>/i,
    canonical: /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i,
    description: /<meta[^>]+name="description"[^>]+content="([^"]+)"/i,
    robots: /<meta[^>]+name="robots"[^>]+content="([^"]+)"/i,
    ogUrl: /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i,
    ogImage: /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
    jsonLd: /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
  };

  return Object.fromEntries(
    Object.entries(patterns).map(([key, pattern]) => [key, html.match(pattern)?.[1] || ""]),
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractArrayBody(source, marker) {
  const markerIndex = source.indexOf(marker);

  if (markerIndex === -1) {
    return "";
  }

  const assignmentIndex = source.indexOf("=", markerIndex);
  const arrayStart = source.indexOf("[", assignmentIndex);

  if (arrayStart === -1) {
    return "";
  }

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(arrayStart + 1, index);
      }
    }
  }

  return "";
}

function extractObjectBlocks(source) {
  const blocks = [];
  let depth = 0;
  let startIndex = -1;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0 && startIndex !== -1) {
        blocks.push(source.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return blocks;
}

function parseProducts() {
  const source = readText(productsSourcePath);
  const productsArray = extractArrayBody(source, "export const products: Product[] = [");
  const productBlocks = extractObjectBlocks(productsArray);

  return productBlocks
    .map((block) => {
      const slugMatch = block.match(/slug:\s*'([^']+)'/);
      const nameMatch = block.match(/name:\s*'([^']+)'/);
      const availableMatch = block.match(/available:\s*(true|false)/);
      const badgeMatch = block.match(/badge:\s*'([^']+)'/);

      if (!slugMatch || !nameMatch) {
        return null;
      }

      return {
        slug: slugMatch[1],
        name: nameMatch[1],
        available: availableMatch ? availableMatch[1] === "true" : true,
        badge: badgeMatch?.[1] || "",
      };
    })
    .filter(Boolean);
}

function getLatestArticle(articles) {
  return articles[0] || null;
}

function getSampleProduct(products) {
  return (
    products.find((product) => product.available && product.badge === "recommended") ||
    products.find((product) => product.available && product.badge === "hit") ||
    products.find((product) => product.available) ||
    null
  );
}

async function main() {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }

  const env = parseEnvFile(envPath);
  const token = env.YANDEX_WEBMASTER_TOKEN;
  const userId = env.YANDEX_WEBMASTER_USER_ID;
  const hostId = env.YANDEX_WEBMASTER_HOST_ID;

  if (!token || !userId || !hostId) {
    throw new Error("YANDEX_WEBMASTER_TOKEN, YANDEX_WEBMASTER_USER_ID and YANDEX_WEBMASTER_HOST_ID must be set");
  }

  const apiBase = `https://api.webmaster.yandex.net/v4/user/${userId}/hosts/${hostId}`;
  const articles = fs.existsSync(articlesApiPath) ? readJson(articlesApiPath) : [];
  const products = fs.existsSync(productsSourcePath) ? parseProducts() : [];
  const latestArticle = getLatestArticle(articles);
  const sampleProduct = getSampleProduct(products);
  const queryParams = new URLSearchParams({
    order_by: "TOTAL_SHOWS",
    limit: "500",
  });
  for (const indicator of ["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION", "AVG_CLICK_POSITION"]) {
    queryParams.append("query_indicator", indicator);
  }

  const [summary, diagnostics, indexingHistory, searchInSearch, sitemaps, popularQueries, inSearchSamples] = await Promise.all([
    requestJson(`${apiBase}/summary/`, token),
    requestJson(`${apiBase}/diagnostics/`, token),
    requestJson(`${apiBase}/indexing/history/`, token),
    requestJson(`${apiBase}/search-urls/in-search/history/`, token),
    requestJson(`${apiBase}/sitemaps/`, token),
    requestJson(`${apiBase}/search-queries/popular/?${queryParams.toString()}`, token),
    requestJson(`${apiBase}/search-urls/in-search/samples/`, token),
  ]);

  const sampleUrls = [
    `${baseUrl}/`,
    `${baseUrl}/catalog`,
    `${baseUrl}/articles`,
    ...(sampleProduct ? [`${baseUrl}/catalog/${sampleProduct.slug}`] : []),
    ...(latestArticle ? [`${baseUrl}/articles/${latestArticle.slug}`] : []),
  ];

  const pages = await Promise.all(sampleUrls.map((url) => fetchHtml(url)));
  const presentProblems = Object.entries(diagnostics.problems || {}).filter(([, value]) => value.state === "PRESENT");
  const searchablePages = summary.searchable_pages_count ?? 0;
  const inSearchLatest = searchInSearch.history?.at(-1)?.value ?? 0;
  const indexing2xxLatest = indexingHistory.indicators?.HTTP_2XX?.at(-1)?.value ?? 0;
  const indexing4xxLatest = indexingHistory.indicators?.HTTP_4XX?.at(-1)?.value ?? 0;
  const excludedLatest = indexingHistory.indicators?.EXCLUDED_BY_NOINDEX?.at(-1)?.value ?? 0;
  const lastAccessedAt = summary.last_access?.last_access_time || "n/a";
  const tokenExpiresAt = env.YANDEX_WEBMASTER_TOKEN_EXPIRES_AT || "n/a";
  const queryRows = popularQueries.queries || [];
  const indexedSamples = inSearchSamples.samples || [];
  const parameterSamples = indexedSamples.filter((sample) => sample.url.includes("?"));
  const trailingSlashSamples = indexedSamples.filter((sample) => {
    try {
      const parsed = new URL(sample.url);
      return parsed.pathname !== "/" && parsed.pathname.endsWith("/");
    } catch {
      return false;
    }
  });
  const queryValue = (query, key) => {
    const value = Number(query.indicators?.[key]);
    return Number.isFinite(value) ? value : 0;
  };

  const lines = [
    `# SEO report for ${baseUrl}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Yandex summary",
    "",
    `- Searchable pages: ${searchablePages}`,
    `- Pages in search (latest): ${inSearchLatest}`,
    `- Indexing HTTP 2XX (latest): ${indexing2xxLatest}`,
    `- Indexing HTTP 4XX (latest): ${indexing4xxLatest}`,
    `- Excluded by noindex (latest): ${excludedLatest}`,
    `- SQI: ${summary.sqi ?? "n/a"}`,
    `- Yandex last access time: ${lastAccessedAt}`,
    `- Token expires at: ${tokenExpiresAt}`,
    "",
    "## Active diagnostics",
    "",
    ...(presentProblems.length
      ? presentProblems.map(([code, value]) => `- ${code}: ${value.severity}${value.description ? ` | ${value.description}` : ""}`)
      : ["- No active diagnostics"]),
    "",
    "## Sitemaps",
    "",
    ...((sitemaps.sitemaps || []).map((entry) =>
      `- ${entry.sitemap_url} | urls=${entry.urls_count} | errors=${entry.errors_count} | processed=${entry.processed ?? "n/a"} | pending=${entry.pending ?? "n/a"}`
    )),
    "",
    "## Popular Yandex queries",
    "",
    `- Period: ${popularQueries.date_from || "n/a"} - ${popularQueries.date_to || "n/a"}`,
    `- Queries available: ${popularQueries.count ?? queryRows.length}`,
    "",
    "| Query | Shows | Clicks | Avg. show position | Avg. click position |",
    "|---|---:|---:|---:|---:|",
    ...queryRows.slice(0, 40).map((query) => {
      const safeText = String(query.query_text || "").replaceAll("|", "\\|");
      const showPosition = queryValue(query, "AVG_SHOW_POSITION");
      const clickPosition = queryValue(query, "AVG_CLICK_POSITION");
      return `| ${safeText} | ${queryValue(query, "TOTAL_SHOWS")} | ${queryValue(query, "TOTAL_CLICKS")} | ${showPosition ? showPosition.toFixed(1) : "-"} | ${clickPosition ? clickPosition.toFixed(1) : "-"} |`;
    }),
    "",
    "## Indexed URL sample quality",
    "",
    `- URLs in sample response: ${indexedSamples.length} of ${inSearchSamples.count ?? "n/a"}`,
    `- Parameter variants in sample: ${parameterSamples.length}`,
    `- Trailing-slash variants in sample: ${trailingSlashSamples.length}`,
    ...parameterSamples.slice(0, 10).map((sample) => `- Parameter sample: ${sample.url}`),
    ...trailingSlashSamples.slice(0, 10).map((sample) => `- Trailing-slash sample: ${sample.url}`),
    "",
    "## Sample route head checks",
    "",
    ...pages.flatMap((page) => {
      const head = extractHeadSignals(page.body);
      return [
        `### ${page.url}`,
        `- Status: ${page.status}`,
        `- Title: ${head.title || "(missing)"}`,
        `- Canonical: ${head.canonical || "(missing)"}`,
        `- Description: ${head.description || "(missing)"}`,
        `- Robots: ${head.robots || "(missing)"}`,
        `- OG URL: ${head.ogUrl || "(missing)"}`,
        `- OG Image: ${head.ogImage || "(missing)"}`,
        `- JSON-LD: ${head.jsonLd ? "present" : "missing"}`,
        "",
      ];
    }),
  ];

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
