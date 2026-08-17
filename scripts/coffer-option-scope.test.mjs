import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const ROOT = new URL('../', import.meta.url);
const PRODUCTS_URL = new URL('src/data/products.ts', ROOT);
const OPTIONS_PAGE_URL = new URL('src/pages/OptionsPage.tsx', ROOT);
const IMAGE_URL = new URL('public/media/options/extreme-three-section-coffer-dimensions.jpg', ROOT);

const TARGET_MODEL_IDS = new Set(['extrime-uaz', 'extrime-toyota', 'extrime-plus-toyota']);

function productBlocks(source) {
  const starts = [...source.matchAll(/^  \{\r?\n    id: '([^']+)'/gm)];
  return starts.map((match, index) => ({
    id: match[1],
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

test('опция ЭКСТРИМ имеет отдельную сущность и подтверждённые параметры', async () => {
  const source = await readFile(PRODUCTS_URL, 'utf8');

  assert.match(source, /id: 'kofr-rear-triple-extreme'/);
  assert.match(source, /name: 'Задний кофр, пластиковый трехсекционный ЭКСТРИМ'/);
  assert.match(source, /price: 75000/);
  assert.match(source, /image: '\/media\/options\/extreme-three-section-coffer-dimensions\.jpg'/);
  assert.match(source, /id: 'kofr-rear-triple'[\s\S]*?name: 'Задний кофр, пластиковый трехсекционный СТАНДАРТ'[\s\S]*?price: 60000/);
});

test('расширенный список подключён только к трём согласованным моделям', async () => {
  const source = await readFile(PRODUCTS_URL, 'utf8');
  const blocks = productBlocks(source).filter(({ body }) => /\n    slug: 'rosomaha-/.test(body));
  const actualTargets = blocks.filter(({ body }) => /\n    options: extremeProductOptions,/.test(body)).map(({ id }) => id);

  assert.deepEqual(new Set(actualTargets), TARGET_MODEL_IDS);
  for (const { id, body } of blocks) {
    if (!TARGET_MODEL_IDS.has(id)) {
      assert.doesNotMatch(body, /\n    options: extremeProductOptions,/);
    }
  }
});

test('общий каталог опций видит отдельную позицию, не подменяя базовый массив', async () => {
  const source = await readFile(OPTIONS_PAGE_URL, 'utf8');

  assert.match(source, /allProductOptions\.map/);
  assert.match(source, /'kofr-rear-triple-extreme': 'cargo'/);
  assert.match(source, /productOptions\.every\(\(option\) => product\.options\.includes\(option\)\)/);
});

test('оптимизированное изображение закреплено точным хешем и размером', async () => {
  const bytes = await readFile(IMAGE_URL);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  assert.equal(bytes.length, 837737);
  assert.equal(sha256, '14d3973bbc0cab0cdcf43e88e97b1632116f0e4219837fd2fb36d07b43ff0eb6');
});
