import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bitrixCatalogUrl = 'https://rosomaha-rus.ru/product/kvadrotsikly/?display=price';

const bitrixSlugToProductId = new Map([
  ['snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota', 'pro-4x4-toyota'],
  ['rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-', 'eger-1'],
  ['standart-plus-1-5-litra', 'standart-plus-suzuki'],
  ['rosomakha-standart-plyus-uaz-timken', 'standart-plus-uaz'],
  ['extrime-s-1-5l-dvs-1nz-fe', 'extrime-uaz'],
  ['extrime-1-5-litra-mosty-toyota', 'extrime-toyota'],
  ['extrime-plus-s-1-8l-dvs-1zz-fe', 'extrime-plus-toyota'],
  ['hunter-s-1-5l-dvs-1nz-fe', 'hunter-toyota'],
  ['snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken', 'pickup-uaz-timken'],
  ['snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz', 'pickup-uaz-18'],
  ['snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', 'pickup-toyota'],
  ['snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', 'sixwheel-toyota'],
  ['pritsep-k-kvadrotsiklu-plavayushchiy-na-obdiryshakh', 'trailer'],
]);

const defaultColumns = [
  'length',
  'width',
  'height',
  'wheelDiameter',
  'clearance',
  'weight',
  'speed',
  'engine',
  'engineVolume',
  'power',
  'axles',
  'configuration',
];

const columnsByProductId = {
  'eger-1': [
    'length',
    'width',
    'height',
    'wheelDiameter',
    'clearance',
    'weight',
    'engine',
    'power',
    'axles',
    'configuration',
  ],
  'sixwheel-toyota': [
    'length',
    'width',
    'height',
    'wheelDiameter',
    'clearance',
    'speed',
    'engine',
    'engineVolume',
    'power',
    'axles',
    'configuration',
  ],
  trailer: ['length', 'width', 'height', 'wheelDiameter', 'weight'],
};

function extractArrayBody(source, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(`Declaration not found: ${declaration}`);
  }

  const open = source.indexOf('[', start + declaration.length - 1);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  throw new Error(`Array is not closed: ${declaration}`);
}

function extractObjectBlocks(source) {
  const blocks = [];
  let start = -1;
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        blocks.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return blocks;
}

function parseLocalProducts() {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'data', 'products.ts'), 'utf8');
  const body = extractArrayBody(source, 'export const products: Product[] = [');
  return new Map(
    extractObjectBlocks(body).map((block) => {
      const id = block.match(/^\s*\{\s*id:\s*'([^']+)'/s)?.[1];
      const price = Number(block.match(/\n\s*basePrice:\s*(\d+)/)?.[1]);
      const specsSource = block.match(/\n\s*specs:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*baseEquipment:/)?.[1] || '';
      const specs = Object.fromEntries(
        [...specsSource.matchAll(/^\s*([A-Za-z]+):\s*'([^']*)'/gm)].map((match) => [match[1], match[2]]),
      );
      return [id, { price, specs }];
    }),
  );
}

function parseCatalogOrder() {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'data', 'catalog.ts'), 'utf8');
  const body = extractArrayBody(source, 'const catalogOrder = [');
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function parseBitrixCatalog(html) {
  const itemStarts = [...html.matchAll(/<meta itemprop="name" content="([^"]+)">/g)];
  const products = [];

  itemStarts.forEach((match, index) => {
    const start = match.index;
    const end = itemStarts[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const bitrixSlug = block.match(/<link itemprop="url" href="\/product\/([^/?"]+)/)?.[1];
    const priceMatch = block.match(/<meta itemprop="price" content="(\d+)">/);
    if (!bitrixSlug || !priceMatch) return;

    const productId = bitrixSlugToProductId.get(bitrixSlug);
    if (!productId) {
      products.push({ productId: null, bitrixSlug });
      return;
    }

    const beforePrice = block.slice(0, priceMatch.index);
    const values = [...beforePrice.matchAll(/<div class="properties__value color_333 font_14 font_short">\s*([^<]+?)\s*<\/div>/g)]
      .map((valueMatch) => valueMatch[1].trim());
    const columns = columnsByProductId[productId] || defaultColumns;
    const specs = Object.fromEntries(columns.map((column, valueIndex) => [column, values[valueIndex]]));
    products.push({
      productId,
      bitrixSlug,
      price: Number(priceMatch[1]),
      specs,
    });
  });

  return products;
}

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('toyota', 'тойота')
    .replace(/\s+/g, ' ');
}

async function main() {
  const response = await fetch(bitrixCatalogUrl, {
    headers: { 'user-agent': 'Rosomaha catalog parity audit/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Bitrix catalog request failed: HTTP ${response.status}`);
  }

  const bitrixProducts = parseBitrixCatalog(await response.text());
  const localProducts = parseLocalProducts();
  const localOrder = parseCatalogOrder();
  const failures = [];

  const unknownBitrixSlugs = bitrixProducts.filter((product) => !product.productId);
  unknownBitrixSlugs.forEach((product) => {
    failures.push(`Unmapped Bitrix product: ${product.bitrixSlug}`);
  });

  const expectedOrder = bitrixProducts.map((product) => product.productId).filter(Boolean);
  if (JSON.stringify(localOrder) !== JSON.stringify(expectedOrder)) {
    failures.push(`Catalog order mismatch\n  Bitrix: ${expectedOrder.join(', ')}\n  local: ${localOrder.join(', ')}`);
  }

  for (const bitrixProduct of bitrixProducts) {
    if (!bitrixProduct.productId) continue;
    const localProduct = localProducts.get(bitrixProduct.productId);
    if (!localProduct) {
      failures.push(`Missing local product: ${bitrixProduct.productId}`);
      continue;
    }

    if (localProduct.price !== bitrixProduct.price) {
      failures.push(
        `${bitrixProduct.productId}.price: Bitrix=${bitrixProduct.price}, local=${localProduct.price}`,
      );
    }

    for (const [key, bitrixValue] of Object.entries(bitrixProduct.specs)) {
      if (!bitrixValue) continue;
      const localValue = localProduct.specs[key];
      if (normalize(localValue) !== normalize(bitrixValue)) {
        failures.push(
          `${bitrixProduct.productId}.${key}: Bitrix=${bitrixValue}, local=${localValue || '<missing>'}`,
        );
      }
    }
  }

  const expectedIds = new Set(expectedOrder);
  for (const localId of localProducts.keys()) {
    if (!expectedIds.has(localId)) {
      failures.push(`Unsupported extra local product: ${localId}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Catalog parity FAIL (${failures.length})`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Catalog parity PASS: ${expectedOrder.length} products match ${bitrixCatalogUrl}`);
}

main().catch((error) => {
  console.error(`Catalog parity ERROR: ${error.message}`);
  process.exitCode = 1;
});
