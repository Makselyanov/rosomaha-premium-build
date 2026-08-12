import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_ARTICLES_RESOLVED_ID,
  CANONICAL_ARTICLES_VIRTUAL_ID,
  createCanonicalArticlesPlugin,
  validateCanonicalArticles,
} from "../vite.config.ts";

const validArticle = {
  id: "article-1",
  slug: "article-one",
  title: "Article one",
  excerpt: "Excerpt one",
  content: "Content one",
  date: "2026-08-12",
  category: "Tests",
};

test("canonical validator rejects an empty payload and invalid required fields", () => {
  assert.throws(() => validateCanonicalArticles([]), /non-empty JSON array/);
  assert.throws(
    () => validateCanonicalArticles([{ ...validArticle, content: "" }]),
    /empty or invalid string field "content"/,
  );
  assert.throws(
    () => validateCanonicalArticles([{ ...validArticle, slug: " article-one" }]),
    /surrounding whitespace/,
  );
});

test("canonical validator rejects duplicate slugs", () => {
  assert.throws(
    () => validateCanonicalArticles([validArticle, { ...validArticle, id: "article-2" }]),
    /duplicate article slug "article-one"/,
  );
});

test("virtual module rejects invalid JSON without producing a manifest", () => {
  const fixtureDir = path.resolve(
    ".codex_tmp",
    `canonical-articles-vite-invalid-${process.pid}-${Date.now()}`,
  );
  const fixturePath = path.join(fixtureDir, "articles.json");

  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(fixturePath, "{not-json", "utf8");

  try {
    const plugin = createCanonicalArticlesPlugin({ sourcePath: fixturePath });
    assert.throws(
      () => plugin.load.call({ addWatchFile() {} }, CANONICAL_ARTICLES_RESOLVED_ID),
      /invalid JSON/,
    );

    const emitted = [];
    plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
    assert.deepEqual(emitted, []);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("virtual module embeds canonical records and emits the exact runtime manifest after load", () => {
  const fixtureDir = path.resolve(
    ".codex_tmp",
    `canonical-articles-vite-test-${process.pid}-${Date.now()}`,
  );
  const fixturePath = path.join(fixtureDir, "articles.json");
  const articles = [
    validArticle,
    { ...validArticle, id: "article-2", slug: "article-two", title: "Article two" },
  ];
  const source = `${JSON.stringify(articles, null, 2)}\n`;

  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(fixturePath, source, "utf8");

  try {
    const plugin = createCanonicalArticlesPlugin({ sourcePath: fixturePath });
    const emittedBeforeLoad = [];
    plugin.generateBundle.call({ emitFile: (asset) => emittedBeforeLoad.push(asset) });
    assert.deepEqual(emittedBeforeLoad, []);

    assert.equal(plugin.resolveId(CANONICAL_ARTICLES_VIRTUAL_ID), CANONICAL_ARTICLES_RESOLVED_ID);
    const watchedPaths = [];
    const moduleSource = plugin.load.call(
      { addWatchFile: (watchedPath) => watchedPaths.push(watchedPath) },
      CANONICAL_ARTICLES_RESOLVED_ID,
    );
    assert.deepEqual(watchedPaths, [fixturePath]);
    assert.match(moduleSource, /article-one/);
    assert.match(moduleSource, /article-two/);

    const emitted = [];
    plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].fileName, "api/articles-runtime-manifest.json");

    const manifest = JSON.parse(emitted[0].source);
    assert.deepEqual(manifest, {
      schema: "rosomaha-canonical-articles-runtime/v1",
      source: "public/api/articles.json",
      count: 2,
      source_sha256: createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex"),
      slug_digest: createHash("sha256").update("article-one\narticle-two\n", "utf8").digest("hex"),
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("bundle emission fails closed if canonical bytes change after virtual module load", () => {
  const fixtureDir = path.resolve(
    ".codex_tmp",
    `canonical-articles-vite-mutation-${process.pid}-${Date.now()}`,
  );
  const fixturePath = path.join(fixtureDir, "articles.json");
  const source = `${JSON.stringify([validArticle], null, 2)}\n`;

  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(fixturePath, source, "utf8");

  try {
    const plugin = createCanonicalArticlesPlugin({ sourcePath: fixturePath });
    plugin.load.call({ addWatchFile() {} }, CANONICAL_ARTICLES_RESOLVED_ID);
    writeFileSync(
      fixturePath,
      `${JSON.stringify([{ ...validArticle, title: "Changed during build" }], null, 2)}\n`,
      "utf8",
    );

    const emitted = [];
    assert.throws(
      () => plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) }),
      /changed between virtual module load and bundle emission/,
    );
    assert.deepEqual(emitted, []);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
