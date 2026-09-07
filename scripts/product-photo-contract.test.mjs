import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'src/data/product-photo-sources.json')));
const source = fs.readFileSync(path.join(root, 'src/data/products.ts'), 'utf8');
test('Every product has an explicit model-bound photo source', () => {
  const ids = [...source.slice(source.indexOf('export const products: Product[]')).matchAll(/\n  \{\s*id: '([^']+)'/g)].map(m=>m[1]);
  assert.equal(rows.length, 13);
  assert.deepEqual(rows.map(x=>x.id).sort(),ids.sort());
  assert.equal(new Set(rows.map(x=>x.sourceUrl)).size,13);
});
for (const row of rows) test(`${row.id}: gallery, thumbnails and bytes match approved model source`, () => {
  const start=source.indexOf(`    id: '${row.id}',`,source.indexOf('export const products: Product[]'));
  const block=source.slice(start,source.indexOf('\n  },',start));
  for(const field of ['gallery','thumbnails']) {
    const tokens=block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`))[1].split(',').map(x=>x.trim()).filter(Boolean);
    assert.deepEqual(tokens,row.images.map(x=>x.token));
  }
  assert.equal(new URL(row.sourceUrl).hostname,'rosomaha-rus.ru');
  for(const photo of row.images) {
    assert.equal(new URL(photo.sourceImage).hostname,'rosomaha-rus.ru');
    const file=path.resolve(root,photo.localPath);
    assert.ok(file.startsWith(root+path.sep));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),photo.sha256);
  }
});
