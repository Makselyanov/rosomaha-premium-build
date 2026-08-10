import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = process.cwd();
const outputPath = path.join(rootDir, "public", "api", "finance-privacy.json");
const canonicalUrl = "https://xn--80aa8ahaki9a.site/politika-konfidencialnosti";
const expectedVersion = "rosomaha-privacy-2026-04-30";
const title = "Политика конфиденциальности и обработки персональных данных";

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function renderPlainText(html) {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "\n- ")
    .replace(/<\/(?:h[1-6]|p|li|section|ul|ol|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(withBreaks)
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();
}

const vite = await createServer({
  root: rootDir,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});

try {
  const [{ default: PrivacyPage }, consentModule] = await Promise.all([
    vite.ssrLoadModule("/src/pages/PrivacyPage.tsx"),
    vite.ssrLoadModule("/src/lib/consent.ts"),
  ]);

  const version = consentModule.PRIVACY_CONSENT_VERSION;
  if (version !== expectedVersion) {
    throw new Error(`Privacy export version mismatch: expected ${expectedVersion}, received ${String(version)}`);
  }

  const html = renderToStaticMarkup(React.createElement(PrivacyPage));
  const text = renderPlainText(html);

  const requiredFragments = [
    title,
    "ООО ТПК «РОСОМАХА»",
    "ООО «ААМХ»",
    "rosomaha-rus.ru",
    "xn--80aa8ahaki9a.site",
    "30» апреля 2026 года",
  ];

  for (const fragment of requiredFragments) {
    if (!text.includes(fragment)) {
      throw new Error(`Privacy export is missing required published fragment: ${fragment}`);
    }
  }

  if (/\b(?:TODO|draft|placeholder|Codex|Claude)\b/i.test(text)) {
    throw new Error("Privacy export contains an internal or unfinished marker.");
  }

  const payload = {
    schema_version: 1,
    kind: "personal_data_processing",
    version,
    title,
    source_url: canonicalUrl,
    effective_from: "2026-04-30T00:00:00+05:00",
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Finance privacy export: ${path.relative(rootDir, outputPath)} (${payload.sha256})`);
} finally {
  await vite.close();
}
