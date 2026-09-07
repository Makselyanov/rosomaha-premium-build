import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.codex_tmp/photo-evidence');
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'src/data/products.ts'), 'utf8');
const parity = fs.readFileSync(path.join(root, 'scripts/audit-catalog-parity.mjs'), 'utf8');
const sourceSlugs = Object.fromEntries([...parity.matchAll(/\['([^']+)', '([^']+)'\]/g)].map(m => [m[2], m[1]]));
const imports = Object.fromEntries([...source.matchAll(/import (\w+) from '@\/([^']+)'/g)].map(m => [m[1], m[2]]));
const products = [...source.slice(source.indexOf('export const products: Product[]')).matchAll(/\n  \{\s*id: '([^']+)',\s*slug: '([^']+)'([\s\S]*?)(?=\n  \{\s*id:|\n\];)/g)];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok || new URL(r.url).host !== new URL(url).host || new URL(r.url).pathname !== new URL(url).pathname) throw new Error(`${url}: ${r.status} or unexpected redirect`);
  return Buffer.from(await r.arrayBuffer());
}
const results = [];
for (const [, id, slug, block] of products) {
  if (!sourceSlugs[id]) throw new Error(`Missing exact source mapping: ${id}`);
  const url = `https://rosomaha-rus.ru/product/${sourceSlugs[id]}/`;
  const bytes = await get(url);
  fs.writeFileSync(path.join(output, `${id}.html`), bytes);
  const html = bytes.toString('utf8');
  const gallery = [...new Set([...html.matchAll(/<a\b[^>]*href="([^"<>]+)"[^>]*data-fancybox="gallery"[^>]*>/g)].filter(m=>m[0].includes('catalog-detail__gallery__link')).map(m => m[1]))];
  if (!gallery.length || gallery.some(x => !/^\/upload\/iblock\/[\w/-]+\.(?:png|jpe?g|webp)$/i.test(x))) throw new Error(`Invalid gallery ${id}`);
  const currentTokens = block.match(/gallery:\s*\[([\s\S]*?)\]/)?.[1].split(',').map(x => x.trim()).filter(Boolean) || [];
  const current = currentTokens.map(x => x.startsWith("'") ? x.slice(1,-1) : imports[x]);
  const row = { id, slug, sourceUrl: url, sourceSha256: sha(bytes), fetchedAt: new Date().toISOString(), gallery, current };
  results.push(row);
  console.log(JSON.stringify({id, gallery, current}));
}
if (results.length !== 13) throw new Error(`Expected 13 products, got ${results.length}`);
const manifestPath = path.join(root, 'src/data/product-photo-sources.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  for (const row of results) {
    const approved = manifest.find(x=>x.id===row.id);
    if (!approved || approved.sourceUrl !== row.sourceUrl || JSON.stringify(row.gallery) !== JSON.stringify(approved.images.map(x=>new URL(x.sourceOriginal).pathname))) throw new Error(`Source gallery changed: ${row.id}`);
    const expected = approved.images.map(x=>x.localPath.startsWith('public/') ? x.localPath.slice(6) : x.localPath.slice(4));
    if (JSON.stringify(expected) !== JSON.stringify(row.current)) throw new Error(`Local gallery differs: ${row.id}`);
  }
  console.log('Photo parity PASS: 13 exact product galleries');
}
fs.writeFileSync(path.join(output, 'mapping.json'), JSON.stringify(results, null, 2) + '\n');
