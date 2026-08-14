import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_BODY_BYTES,
  PAGE_CONFIGS,
  fetchPage,
  parseCategoryHtml,
  runAudit,
  saveReceipt,
} from './bitrix-category-seo-baseline.mjs';

const CHILD_CONFIG = { ...PAGE_CONFIGS.find((item) => item.id === 'classic-clean'), expectedSlugs: null };

function product(slug, price = 100, extra = '', options = {}) {
  const query = options.oid ? `?oid=${options.oid}` : '';
  const name = options.textValues
    ? `<span itemprop="name">Модель ${slug}</span>`
    : `<meta itemprop="name" content="Модель ${slug}">`;
  const priceTag = options.textValues
    ? `<span itemprop="price">${price}</span><span itemprop="priceCurrency">RUB</span>`
    : `<meta itemprop="price" content="${price}"><meta itemprop="priceCurrency" content="RUB">`;
  return `<article itemscope itemtype="https://schema.org/Product">
    ${name}
    <link itemprop="url" href="/product/${slug}/${query}">
    ${priceTag}${extra}
  </article>`;
}

function htmlFor(config, options = {}) {
  const slugs = options.slugs ?? config.expectedSlugs ?? ['alpha'];
  const products = slugs.map((slug, index) => product(slug, options.priceBase === undefined ? 100 + index : options.priceBase + index)).join('\n');
  return `<!doctype html><html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>${options.title ?? 'Категория'}</title>
    <link rel="canonical" href="${config.requestUrl}">
    <meta name="robots" content="${options.robots ?? 'index,follow'}">
    ${options.jsonLd ?? '<script type="application/ld+json">{"@type":"CollectionPage"}</script>'}
  </head><body>${options.h1 === false ? '' : `<h1>${options.h1 ?? 'Квадроциклы'}</h1>`}
    ${options.extraH1 ? '<h1>Второй</h1>' : ''}${products}${options.extra ?? ''}
  </body></html>`;
}

function responseFor(url, html, options = {}) {
  const body = options.body ?? Buffer.from(html, 'utf8');
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: {
      'content-type': options.contentType ?? 'text/html; charset=utf-8',
      ...(options.contentLength ? { 'content-length': String(options.contentLength) } : {}),
      ...(options.location ? { location: options.location } : {}),
    },
  });
  Object.defineProperty(response, 'url', { value: options.finalUrl ?? url });
  return response;
}

test('фиксированный allowlist содержит только 10 URL Bitrix без fragment', () => {
  assert.equal(PAGE_CONFIGS.length, 10);
  assert.equal(new Set(PAGE_CONFIGS.map((item) => item.requestUrl)).size, 10);
  PAGE_CONFIGS.forEach((item) => {
    const url = new URL(item.requestUrl);
    assert.equal(url.origin, 'https://rosomaha-rus.ru');
    assert.equal(url.hash, '');
    assert.match(url.pathname, /^\/product\/kvadrotsikly\//);
    assert.ok(url.search === '' || ['?display=list', '?display=price'].includes(url.search));
  });
});

test('валидный HTML даёт безопасную карточку и browser-claims остаются false', () => {
  const parsed = parseCategoryHtml(htmlFor(CHILD_CONFIG), CHILD_CONFIG);
  assert.deepEqual(parsed.blockers, []);
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].slug, 'alpha');
  assert.equal(parsed.products[0].price, 100);
  assert.equal(parsed.serverHtmlObservations.provesRenderedVisibility, false);
  assert.equal(parsed.serverHtmlObservations.provesStockTruth, false);
  assert.equal(parsed.serverHtmlObservations.provesFormFunctionality, false);
});

test('отсутствующий H1 блокирует, несколько H1 дают только предупреждение', () => {
  const missing = parseCategoryHtml(htmlFor(CHILD_CONFIG, { h1: false }), CHILD_CONFIG);
  assert.ok(missing.blockers.includes('h1_missing'));
  const multiple = parseCategoryHtml(htmlFor(CHILD_CONFIG, { extraH1: true }), CHILD_CONFIG);
  assert.ok(!multiple.blockers.includes('h1_count_not_exactly_one'));
  assert.ok(multiple.warnings.includes('multiple_h1'));
});

test('noindex и сломанный JSON-LD блокируют страницу', () => {
  const parsed = parseCategoryHtml(htmlFor(CHILD_CONFIG, {
    robots: 'noindex,follow',
    jsonLd: '<script type="application/ld+json">{bad}</script>',
  }), CHILD_CONFIG);
  assert.ok(parsed.blockers.includes('blocking_robots'));
  assert.ok(parsed.blockers.includes('invalid_json_ld'));
});

test('дубликат slug и конфликт цены не принимаются', () => {
  const parsed = parseCategoryHtml(htmlFor(CHILD_CONFIG, {
    extra: product('alpha', 999),
  }), CHILD_CONFIG);
  assert.ok(parsed.blockers.includes('microdata_conflicting_duplicate'));
});

test('canonical обязан точно совпадать с проверяемым URL и не может вести на другой домен', () => {
  const wrong = htmlFor(CHILD_CONFIG).replace(CHILD_CONFIG.requestUrl, 'https://xn--80aa8ahaki9a.site/');
  const parsed = parseCategoryHtml(wrong, CHILD_CONFIG);
  assert.ok(parsed.blockers.includes('canonical_mismatch'));
});

test('breadcrumb itemprop name вне Product не создаёт ложную карточку', () => {
  const html = htmlFor(CHILD_CONFIG, { extra: '<nav><span itemprop="name">Каталог</span></nav>' });
  const parsed = parseCategoryHtml(html, CHILD_CONFIG);
  assert.deepEqual(parsed.blockers, []);
  assert.equal(parsed.products.length, 1);
});

test('два oid одного slug остаются двумя offer identities без ложного duplicate', () => {
  const html = htmlFor(CHILD_CONFIG, {
    slugs: [],
    extra: `${product('alpha', 100, '', { oid: '812' })}${product('alpha', 120, '', { oid: '824' })}`,
  });
  const parsed = parseCategoryHtml(html, CHILD_CONFIG);
  assert.ok(!parsed.blockers.some((item) => item.includes('duplicate')));
  assert.equal(parsed.products.length, 2);
  assert.deepEqual(parsed.products.map((item) => item.oid), ['812', '824']);
});

test('secondary extractor не может потерять один из двух oid', () => {
  const oneDataItem = JSON.stringify({ DETAIL_PAGE_URL: '/product/alpha/?oid=812', NAME: 'Модель alpha', PRICE: 100 })
    .replaceAll('"', '&quot;');
  const html = htmlFor(CHILD_CONFIG, {
    slugs: [],
    extra: `${product('alpha', 100, '', { oid: '812' })}${product('alpha', 120, '', { oid: '824' })}<div data-item="${oneDataItem}"></div>`,
  });
  const parsed = parseCategoryHtml(html, CHILD_CONFIG);
  assert.ok(parsed.blockers.includes('card_extractors_offer_identity_mismatch'));
});

test('secondary extractor может не дублировать чистую карточку без oid', () => {
  const oidDataItem = JSON.stringify({
    DETAIL_PAGE_URL: '/product/alpha/?oid=812',
    NAME: 'Модель alpha',
    PROPERTY_FILTER_PRICE_VALUE: '100',
  }).replaceAll('"', '&quot;');
  const html = htmlFor(CHILD_CONFIG, {
    slugs: [],
    extra: `${product('alpha', 100, '', { oid: '812' })}${product('trailer', 230)}<div data-item="${oidDataItem}"></div>`,
  });
  const parsed = parseCategoryHtml(html, CHILD_CONFIG);
  assert.ok(!parsed.blockers.includes('card_extractors_slug_mismatch'));
  assert.ok(!parsed.blockers.includes('card_extractors_offer_identity_mismatch'));
  assert.ok(!parsed.blockers.includes('card_extractors_price_mismatch'));
});

test('faithful Bitrix shape: 12 oid и чистый прицеп дают 13 unique products', () => {
  const config = PAGE_CONFIGS.find((item) => item.id === 'main-price');
  const trailerSlug = 'pritsep-k-kvadrotsiklu-plavayushchiy-na-obdiryshakh';
  const oidBySlug = new Map([
    ['snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota', '1101'],
    ['rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-', '968'],
    ['standart-plus-1-5-litra', '764'],
    ['rosomakha-standart-plyus-uaz-timken', '907'],
    ['extrime-s-1-5l-dvs-1nz-fe', '812'],
    ['extrime-1-5-litra-mosty-toyota', '824'],
    ['extrime-plus-s-1-8l-dvs-1zz-fe', '788'],
    ['hunter-s-1-5l-dvs-1nz-fe', '800'],
    ['snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken', '991'],
    ['snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz', '929'],
    ['snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', '919'],
    ['snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', '945'],
  ]);
  const cards = [];
  const dataItems = [];
  config.expectedSlugs.forEach((slug, index) => {
    const price = 1000 + index;
    if (slug === trailerSlug) {
      cards.push(product(slug, price));
      return;
    }
    const oid = oidBySlug.get(slug);
    assert.ok(oid, `Нет faithful oid для ${slug}`);
    cards.push(product(slug, price, '', { oid }));
    dataItems.push(`<div data-item="${JSON.stringify({
      DETAIL_PAGE_URL: `/product/${slug}/?oid=${oid}`,
      NAME: `Модель ${slug}`,
      PROPERTY_FILTER_PRICE_VALUE: String(price),
    }).replaceAll('"', '&quot;')}"></div>`);
  });
  const parsed = parseCategoryHtml(htmlFor(config, { slugs: [], extra: `${cards.join('')}${dataItems.join('')}` }), config);
  assert.deepEqual(parsed.blockers, []);
  assert.equal(parsed.products.length, 13);
  assert.equal(new Set(parsed.products.map((item) => item.slug)).size, 13);
  assert.equal(parsed.secondaryExtractor.products.length, 12);
});

test('изменённый PROPERTY_FILTER_PRICE_VALUE блокирует exact offer price parity', () => {
  const dataItem = JSON.stringify({
    DETAIL_PAGE_URL: '/product/alpha/?oid=812',
    NAME: 'Модель alpha',
    PROPERTY_FILTER_PRICE_VALUE: '101',
  }).replaceAll('"', '&quot;');
  const html = htmlFor(CHILD_CONFIG, {
    slugs: [],
    extra: `${product('alpha', 100, '', { oid: '812' })}<div data-item="${dataItem}"></div>`,
  });
  const parsed = parseCategoryHtml(html, CHILD_CONFIG);
  assert.ok(parsed.blockers.includes('card_extractors_price_mismatch'));
});

test('microdata name, price и currency читаются из текста тега', () => {
  const html = htmlFor(CHILD_CONFIG, { slugs: [], extra: product('alpha', 100, '', { textValues: true }) });
  const parsed = parseCategoryHtml(html, CHILD_CONFIG);
  assert.deepEqual(parsed.blockers, []);
  assert.equal(parsed.products[0].name, 'Модель alpha');
  assert.equal(parsed.products[0].price, 100);
  assert.equal(parsed.products[0].currency, 'RUB');
});

test('второй data-item extractor обязан совпадать с microdata', () => {
  const good = JSON.stringify({ DETAIL_PAGE_URL: '/product/alpha/', NAME: 'Модель alpha', PRICE: 100 }).replaceAll('"', '&quot;');
  const valid = parseCategoryHtml(htmlFor(CHILD_CONFIG, { extra: `<div data-item="${good}"></div>` }), CHILD_CONFIG);
  assert.ok(!valid.blockers.some((item) => item.startsWith('card_extractors_')));

  const bad = JSON.stringify({ DETAIL_PAGE_URL: '/product/beta/', NAME: 'Модель beta', PRICE: 100 }).replaceAll('"', '&quot;');
  const mismatch = parseCategoryHtml(htmlFor(CHILD_CONFIG, { extra: `<div data-item="${bad}"></div>` }), CHILD_CONFIG);
  assert.ok(mismatch.blockers.includes('card_extractors_slug_mismatch'));
});

test('unknown URL запрещён до HTTP', async () => {
  let calls = 0;
  await assert.rejects(
    fetchPage({ ...CHILD_CONFIG, requestUrl: 'https://example.com/' }, async () => { calls += 1; }),
    /url_not_allowlisted/,
  );
  assert.equal(calls, 0);
});

test('redirect и несовпавший final URL запрещены', async () => {
  await assert.rejects(
    fetchPage(CHILD_CONFIG, async (url) => responseFor(url, '', { status: 302, location: '/other' })),
    /redirect_rejected/,
  );
  await assert.rejects(
    fetchPage(CHILD_CONFIG, async (url) => responseFor(url, htmlFor(CHILD_CONFIG), { finalUrl: `${url}changed` })),
    /final_url_mismatch/,
  );
});

test('слишком большой body и неверный UTF-8 блокируются', async () => {
  await assert.rejects(
    fetchPage(CHILD_CONFIG, async (url) => responseFor(url, '', { contentLength: MAX_BODY_BYTES + 1 })),
    /body_too_large/,
  );
  await assert.rejects(
    fetchPage(CHILD_CONFIG, async (url) => responseFor(url, '', { body: Buffer.from([0xc3, 0x28]) })),
    /invalid_utf8/,
  );
});

test('аудит 10 URL проходит при exact parity и не делает writes в тестовом режиме', async () => {
  const fetchImpl = async (url) => {
    const config = PAGE_CONFIGS.find((item) => item.requestUrl === url);
    const groupSlugs = config.expectedSlugs ?? [`${config.group}-one`];
    return responseFor(url, htmlFor(config, { slugs: groupSlugs }));
  };
  const { receipt, saved } = await runAudit({ fetchImpl, save: false, now: new Date('2026-08-14T00:00:00Z') });
  assert.equal(saved, null);
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.pages.length, 10);
  assert.equal(receipt.readyForCmsDiff, true);
  assert.equal(receipt.domains.crossDomainMetricsOrConclusionsUsed, false);
  assert.equal(receipt.assertions.noMutation, true);
  assert.equal(receipt.taxonomyObservation.businessCorrectnessConfirmed, false);
  assert.equal(receipt.taxonomyObservation.followUpRequiredBeforeReclassification, true);
});

test('межвариантный price drift даёт seo_mismatch', async () => {
  const fetchImpl = async (url) => {
    const config = PAGE_CONFIGS.find((item) => item.requestUrl === url);
    const slugs = config.expectedSlugs ?? [`${config.group}-one`];
    const priceBase = config.id === 'classic-price' ? 200 : 100;
    return responseFor(url, htmlFor(config, { slugs, priceBase }));
  };
  const { receipt } = await runAudit({ fetchImpl, save: false });
  assert.equal(receipt.status, 'seo_mismatch');
  assert.ok(receipt.blockers.includes('classic_variant_price_mismatch'));
});

test('immutable receipt не перезаписывается, latest_pass не заменяется ошибкой', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitrix-seo-receipt-'));
  const now = new Date('2026-08-14T00:00:00Z');
  try {
    const pass = saveReceipt({ receiptVersion: 1, status: 'pass' }, { directory, now });
    const latestPassBefore = fs.readFileSync(path.join(directory, 'latest_pass.json'), 'utf8');
    assert.throws(() => saveReceipt({ receiptVersion: 1, status: 'pass' }, { directory, now }), /EEXIST/);
    assert.equal(fs.readFileSync(pass.filePath, 'utf8'), '{\n  "receiptVersion": 1,\n  "status": "pass"\n}\n');

    saveReceipt({ receiptVersion: 1, status: 'seo_mismatch' }, { directory, now: new Date('2026-08-14T00:00:01Z') });
    assert.equal(fs.readFileSync(path.join(directory, 'latest_pass.json'), 'utf8'), latestPassBefore);
    assert.match(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'), /seo_mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
