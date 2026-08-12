import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { componentTagger } from "lovable-tagger";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_ARTICLES_PATH = path.join(PROJECT_ROOT, "public", "api", "articles.json");
export const CANONICAL_ARTICLES_VIRTUAL_ID = "virtual:canonical-articles";
export const CANONICAL_ARTICLES_RESOLVED_ID = `\0${CANONICAL_ARTICLES_VIRTUAL_ID}`;

const REQUIRED_ARTICLE_FIELDS = ["id", "title", "excerpt", "content", "date", "category"];

export function validateCanonicalArticles(payload: unknown, sourceLabel = "public/api/articles.json") {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`${sourceLabel}: expected a non-empty JSON array`);
  }

  const slugs = new Set<string>();

  for (const [index, article] of payload.entries()) {
    if (!article || typeof article !== "object" || Array.isArray(article)) {
      throw new Error(`${sourceLabel}: article at index ${index} must be an object`);
    }

    const candidate = article as Record<string, unknown>;
    if (typeof candidate.slug !== "string" || candidate.slug.trim().length === 0) {
      throw new Error(`${sourceLabel}: article at index ${index} has an empty or invalid slug`);
    }

    if (candidate.slug !== candidate.slug.trim()) {
      throw new Error(`${sourceLabel}: article slug "${candidate.slug}" contains surrounding whitespace`);
    }

    if (slugs.has(candidate.slug)) {
      throw new Error(`${sourceLabel}: duplicate article slug "${candidate.slug}"`);
    }
    slugs.add(candidate.slug);

    for (const field of REQUIRED_ARTICLE_FIELDS) {
      const value = candidate[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(
          `${sourceLabel}: article "${candidate.slug}" has an empty or invalid string field "${field}"`,
        );
      }
    }
  }

  return payload as Array<Record<string, unknown>>;
}

export function createCanonicalArticlesPlugin({ sourcePath = CANONICAL_ARTICLES_PATH } = {}) {
  let runtimeManifest: Record<string, string | number> | null = null;
  let loadedSourceBytes: Buffer | null = null;
  let loadedSourceSha256: string | null = null;

  return {
    name: "rosomaha-canonical-articles-runtime",
    enforce: "pre" as const,
    resolveId(id: string) {
      return id === CANONICAL_ARTICLES_VIRTUAL_ID ? CANONICAL_ARTICLES_RESOLVED_ID : null;
    },
    load(id: string) {
      if (id !== CANONICAL_ARTICLES_RESOLVED_ID) {
        return null;
      }

      this.addWatchFile(sourcePath);
      const sourceBytes = readFileSync(sourcePath);
      let payload: unknown;

      try {
        payload = JSON.parse(sourceBytes.toString("utf8"));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`public/api/articles.json: invalid JSON (${reason})`);
      }

      const articles = validateCanonicalArticles(payload);
      const sortedSlugs = articles.map((article) => String(article.slug)).sort();
      loadedSourceBytes = Buffer.from(sourceBytes);
      loadedSourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
      runtimeManifest = {
        schema: "rosomaha-canonical-articles-runtime/v1",
        source: "public/api/articles.json",
        count: articles.length,
        source_sha256: loadedSourceSha256,
        slug_digest: createHash("sha256").update(`${sortedSlugs.join("\n")}\n`, "utf8").digest("hex"),
      };

      return `const canonicalArticles = ${JSON.stringify(articles)};\nexport default canonicalArticles;\n`;
    },
    generateBundle() {
      if (runtimeManifest === null || loadedSourceBytes === null || loadedSourceSha256 === null) {
        return;
      }

      const currentSourceBytes = readFileSync(sourcePath);
      const currentSourceSha256 = createHash("sha256").update(currentSourceBytes).digest("hex");
      if (
        currentSourceSha256 !== loadedSourceSha256 ||
        !currentSourceBytes.equals(loadedSourceBytes)
      ) {
        throw new Error(
          "public/api/articles.json changed between virtual module load and bundle emission",
        );
      }

      this.emitFile({
        type: "asset",
        fileName: "api/articles-runtime-manifest.json",
        source: `${JSON.stringify(runtimeManifest, null, 2)}\n`,
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    createCanonicalArticlesPlugin(),
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(PROJECT_ROOT, "src"),
    },
  },
}));
