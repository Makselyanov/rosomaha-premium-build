import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPORT_DIR = path.join(PROJECT_ROOT, 'marketing-audits', 'bitrix-category-seo');
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const ORIGIN = 'https://rosomaha-rus.ru';

const EXPECTED_MAIN_SLUGS = Object.freeze([
  'snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota',
  'rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-',
  'standart-plus-1-5-litra',
  'rosomakha-standart-plyus-uaz-timken',
  'extrime-s-1-5l-dvs-1nz-fe',
  'extrime-1-5-litra-mosty-toyota',
  'extrime-plus-s-1-8l-dvs-1zz-fe',
  'hunter-s-1-5l-dvs-1nz-fe',
  'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken',
  'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz',
  'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota',
  'snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota',
  'pritsep-k-kvadrotsiklu-plavayushchiy-na-obdiryshakh',
].sort());

const EXPECTED_CLASSIC_SLUGS = Object.freeze([
  'snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota',
  'rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-',
  'standart-plus-1-5-litra',
  'rosomakha-standart-plyus-uaz-timken',
  'extrime-s-1-5l-dvs-1nz-fe',
  'extrime-1-5-litra-mosty-toyota',
  'extrime-plus-s-1-8l-dvs-1zz-fe',
  'hunter-s-1-5l-dvs-1nz-fe',
].sort());

const EXPECTED_PICKUP_SLUGS = Object.freeze([
  'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken',
  'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz',
  'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota',
].sort());

const EXPECTED_TRAILER_SLUGS = Object.freeze([
  'pritsep-k-kvadrotsiklu-plavayushchiy-na-obdiryshakh',
]);

function page(id, pathname, search, group, expectedSlugs = null) {
  const requestUrl = `${ORIGIN}${pathname}${search}`;
  return Object.freeze({ id, requestUrl, expectedFinalUrl: requestUrl, group, expectedSlugs });
}

export const PAGE_CONFIGS = Object.freeze([
  page('main-clean', '/product/kvadrotsikly/', '', 'main', EXPECTED_MAIN_SLUGS),
  page('main-price', '/product/kvadrotsikly/', '?display=price', 'main', EXPECTED_MAIN_SLUGS),
  page('classic-clean', '/product/kvadrotsikly/klassicheskie-modeli/', '', 'classic', EXPECTED_CLASSIC_SLUGS),
  page('classic-list', '/product/kvadrotsikly/klassicheskie-modeli/', '?display=list', 'classic', EXPECTED_CLASSIC_SLUGS),
  page('classic-price', '/product/kvadrotsikly/klassicheskie-modeli/', '?display=price', 'classic', EXPECTED_CLASSIC_SLUGS),
  page('pickup-clean', '/product/kvadrotsikly/pikapy/', '', 'pickup', EXPECTED_PICKUP_SLUGS),
  page('pickup-price', '/product/kvadrotsikly/pikapy/', '?display=price', 'pickup', EXPECTED_PICKUP_SLUGS),
  page('trailer-clean', '/product/kvadrotsikly/pritsepy/', '', 'trailer', EXPECTED_TRAILER_SLUGS),
  page('trailer-list', '/product/kvadrotsikly/pritsepy/', '?display=list', 'trailer', EXPECTED_TRAILER_SLUGS),
  page('trailer-price', '/product/kvadrotsikly/pritsepy/', '?display=price', 'trailer', EXPECTED_TRAILER_SLUGS),
]);

const ALLOWED_URLS = new Set(PAGE_CONFIGS.map((item) => item.requestUrl));
const ENTITY_MAP = Object.freeze({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodeHtml(value = '') {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lowered = entity.toLowerCase();
    if (lowered.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lowered.slice(2), 16));
    if (lowered.startsWith('#')) return String.fromCodePoint(Number.parseInt(lowered.slice(1), 10));
    return ENTITY_MAP[lowered] ?? match;
  });
}

function normalizeText(value = '') {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseAttributes(source = '') {
  const attributes = Object.create(null);
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    if (Object.hasOwn(attributes, key)) continue;
    attributes[key] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function scanTags(html) {
  const tags = [];
  const pattern = /<(\/?)\s*([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const match of html.matchAll(pattern)) {
    tags.push({
      name: match[2].toLowerCase(),
      attrs: match[1] ? Object.create(null) : parseAttributes(match[3]),
      index: match.index,
      end: match.index + match[0].length,
      closing: Boolean(match[1]),
      selfClosing: !match[1] && /\/\s*$/.test(match[3]),
    });
  }
  return tags;
}

function tagValues(html, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi');
  return [...html.matchAll(pattern)].map((match) => normalizeText(match[1])).filter(Boolean);
}

function parseProductUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, ORIGIN);
    if (parsed.origin !== ORIGIN || parsed.hash) return null;
    const match = parsed.pathname.match(/^\/product\/([^/]+)\/?$/);
    if (!match) return null;
    const entries = [...parsed.searchParams.entries()];
    if (entries.some(([key]) => key !== 'oid') || entries.length > 1) return null;
    const oid = entries[0]?.[1] ?? null;
    if (oid !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(oid)) return null;
    const slug = decodeURIComponent(match[1]);
    const detailUrl = `${ORIGIN}/product/${encodeURIComponent(slug)}/`;
    const normalizedUrl = oid === null ? detailUrl : `${detailUrl}?oid=${encodeURIComponent(oid)}`;
    return { slug, oid, detailUrl, normalizedUrl, identity: `${slug}\u0000${oid ?? ''}` };
  } catch {
    return null;
  }
}

function itempropIncludes(attrs, value) {
  return String(attrs.itemprop ?? '').toLowerCase().split(/\s+/).includes(value);
}

function tagInnerText(html, tag, blockTags, tagPosition) {
  if (tag.attrs.content !== undefined && tag.attrs.content !== '') return normalizeText(tag.attrs.content);
  let depth = 0;
  for (let index = tagPosition + 1; index < blockTags.length; index += 1) {
    const candidate = blockTags[index];
    if (candidate.name !== tag.name) continue;
    if (!candidate.closing && !candidate.selfClosing) depth += 1;
    if (candidate.closing) {
      if (depth === 0) return normalizeText(html.slice(tag.end, candidate.index));
      depth -= 1;
    }
  }
  return '';
}

function findProductScopes(tags, blockers) {
  const scopes = [];
  for (let index = 0; index < tags.length; index += 1) {
    const start = tags[index];
    if (start.closing || start.selfClosing || !Object.hasOwn(start.attrs, 'itemscope')) continue;
    if (!String(start.attrs.itemtype ?? '').toLowerCase().includes('schema.org/product')) continue;
    let depth = 0;
    let end = -1;
    for (let cursor = index + 1; cursor < tags.length; cursor += 1) {
      const candidate = tags[cursor];
      if (candidate.name !== start.name) continue;
      if (!candidate.closing && !candidate.selfClosing) depth += 1;
      if (candidate.closing) {
        if (depth === 0) {
          end = cursor;
          break;
        }
        depth -= 1;
      }
    }
    if (end === -1) {
      blockers.push('unclosed_product_itemscope');
      continue;
    }
    scopes.push({ start: index, end });
  }
  return scopes;
}

function parseNumericValue(value) {
  const normalized = normalizeText(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

function parseMicrodataProducts(html, tags, blockers) {
  const records = [];
  for (const scope of findProductScopes(tags, blockers)) {
    const block = tags.slice(scope.start + 1, scope.end);
    const urlTag = block.find((tag) => !tag.closing && itempropIncludes(tag.attrs, 'url') && parseProductUrl(tag.attrs.href ?? tag.attrs.content));
    if (!urlTag) continue;
    const parsedUrl = parseProductUrl(urlTag.attrs.href ?? urlTag.attrs.content);
    const namePosition = block.findIndex((tag) => !tag.closing && itempropIncludes(tag.attrs, 'name'));
    const pricePosition = block.findIndex((tag) => !tag.closing && itempropIncludes(tag.attrs, 'price'));
    const currencyPosition = block.findIndex((tag) => !tag.closing && itempropIncludes(tag.attrs, 'pricecurrency'));
    const nameTag = namePosition >= 0 ? block[namePosition] : null;
    const priceTag = pricePosition >= 0 ? block[pricePosition] : null;
    const currencyTag = currencyPosition >= 0 ? block[currencyPosition] : null;
    records.push({
      ...parsedUrl,
      name: nameTag ? tagInnerText(html, nameTag, block, namePosition) : '',
      price: priceTag ? parseNumericValue(tagInnerText(html, priceTag, block, pricePosition)) : null,
      currency: currencyTag ? tagInnerText(html, currencyTag, block, currencyPosition) : '',
    });
  }
  return records;
}

function firstDefined(object, keys) {
  for (const key of keys) if (object && object[key] !== undefined && object[key] !== null) return object[key];
  return null;
}

function parseDataItemProducts(html, blockers) {
  const records = [];
  const pattern = /\bdata-item\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const value = JSON.parse(decodeHtml(match[1] ?? match[2] ?? ''));
      const url = firstDefined(value, ['DETAIL_PAGE_URL', 'DETAIL_PAGE_URL_TEMPLATE', 'URL', 'url']);
      const parsedUrl = parseProductUrl(String(url ?? ''));
      if (!parsedUrl) continue;
      const priceValue = firstDefined(value, ['PRICE', 'price', 'BASE_PRICE', 'PROPERTY_FILTER_PRICE_VALUE']);
      records.push({
        ...parsedUrl,
        name: normalizeText(String(firstDefined(value, ['NAME', 'name']) ?? '')),
        price: priceValue === null || priceValue === '' ? null : parseNumericValue(String(priceValue)),
      });
    } catch {
      blockers.push('invalid_data_item_json');
    }
  }
  return records;
}

function summarizeRecords(records, prefix, blockers) {
  const byIdentity = new Map();
  for (const record of records) {
    if (!record.slug) continue;
    const previous = byIdentity.get(record.identity);
    if (previous) {
      if (previous.normalizedUrl !== record.normalizedUrl || previous.price !== record.price || previous.name !== record.name) {
        blockers.push(`${prefix}_conflicting_duplicate`);
      } else {
        blockers.push(`${prefix}_duplicate_identity`);
      }
      continue;
    }
    byIdentity.set(record.identity, record);
  }
  return [...byIdentity.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

function uniqueSortedSlugs(records) {
  return [...new Set(records.map((item) => item.slug))].sort();
}

function flattenJsonLd(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJsonLd(item, output));
  } else if (value && typeof value === 'object') {
    output.push(value);
    if (Array.isArray(value['@graph'])) flattenJsonLd(value['@graph'], output);
  }
  return output;
}

function parseJsonLd(html, blockers) {
  const safe = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = parseAttributes(match[1]);
    if (String(attrs.type).toLowerCase() !== 'application/ld+json') continue;
    try {
      const nodes = flattenJsonLd(JSON.parse(match[2]));
      for (const node of nodes) {
        const type = Array.isArray(node['@type']) ? node['@type'].map(String) : [String(node['@type'] ?? '')];
        const compact = { types: type.filter(Boolean).sort() };
        if (compact.types.includes('Product')) {
          compact.name = normalizeText(String(node.name ?? ''));
          compact.url = typeof node.url === 'string' ? node.url : null;
          compact.sku = typeof node.sku === 'string' ? node.sku : null;
        }
        safe.push(compact);
      }
    } catch {
      blockers.push('invalid_json_ld');
    }
  }
  return safe;
}

function exactSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function parseCategoryHtml(html, config) {
  if (!config || !ALLOWED_URLS.has(config.requestUrl)) throw new Error('config_not_allowlisted');
  const blockers = [];
  const warnings = [];
  const tags = scanTags(html);
  const titles = tagValues(html, 'title');
  const h1 = tagValues(html, 'h1');
  const canonical = tags
    .filter((tag) => !tag.closing && tag.name === 'link' && String(tag.attrs.rel).toLowerCase().split(/\s+/).includes('canonical'))
    .map((tag) => tag.attrs.href)
    .filter(Boolean);
  const robots = tags
    .filter((tag) => tag.name === 'meta' && String(tag.attrs.name).toLowerCase() === 'robots')
    .map((tag) => String(tag.attrs.content).toLowerCase());

  if (titles.length !== 1) blockers.push('title_count_not_exactly_one');
  if (h1.length === 0) blockers.push('h1_missing');
  if (h1.length > 1) warnings.push('multiple_h1');
  if (canonical.length !== 1) blockers.push('canonical_count_not_exactly_one');
  if (canonical.length === 1) {
    try {
      if (new URL(canonical[0], config.requestUrl).href !== config.expectedFinalUrl) blockers.push('canonical_mismatch');
    } catch {
      blockers.push('canonical_mismatch');
    }
  }
  if (robots.some((value) => /(?:^|[,\s])(noindex|nofollow)(?:$|[,\s])/.test(value))) blockers.push('blocking_robots');

  const microdata = summarizeRecords(parseMicrodataProducts(html, tags, blockers), 'microdata', blockers);
  const dataItems = summarizeRecords(parseDataItemProducts(html, blockers), 'data_item', blockers);
  if (microdata.length === 0) blockers.push('product_cards_missing');
  if (microdata.some((item) => item.price === null || !Number.isFinite(item.price))) blockers.push('product_price_missing');

  if (dataItems.length > 0) {
    const microSlugs = uniqueSortedSlugs(microdata);
    const dataSlugs = uniqueSortedSlugs(dataItems);
    const requiredMicroSlugs = uniqueSortedSlugs(microdata.filter((item) => item.oid !== null));
    if (
      requiredMicroSlugs.some((slug) => !dataSlugs.includes(slug))
      || dataSlugs.some((slug) => !microSlugs.includes(slug))
    ) {
      blockers.push('card_extractors_slug_mismatch');
    }
    const microIdentities = microdata.map((item) => item.identity).sort();
    const requiredMicroIdentities = microdata.filter((item) => item.oid !== null).map((item) => item.identity).sort();
    const dataIdentities = dataItems.map((item) => item.identity).sort();
    const dataIdentitySet = new Set(dataIdentities);
    if (
      requiredMicroIdentities.some((identity) => !dataIdentitySet.has(identity))
      || dataIdentities.some((identity) => !microIdentities.includes(identity))
    ) {
      blockers.push('card_extractors_offer_identity_mismatch');
    }
    for (const dataItem of dataItems) {
      const micro = microdata.find((item) => item.identity === dataItem.identity);
      if (micro && dataItem.price !== null && Number.isFinite(dataItem.price) && micro.price !== dataItem.price) {
        blockers.push('card_extractors_price_mismatch');
      }
    }
  }

  if (config.expectedSlugs && !exactSet(uniqueSortedSlugs(microdata), config.expectedSlugs)) {
    blockers.push('expected_product_slug_set_mismatch');
  }

  const jsonLd = parseJsonLd(html, blockers);
  return {
    title: titles,
    h1,
    canonical,
    robots,
    jsonLd,
    products: microdata,
    secondaryExtractor: { present: dataItems.length > 0, products: dataItems },
    serverHtmlObservations: {
      orderTextCount: (normalizeText(html).match(/\bзаказать\b/giu) ?? []).length,
      stockTextCount: (normalizeText(html).match(/\bв наличии\b/giu) ?? []).length,
      formTagCount: tags.filter((tag) => !tag.closing && tag.name === 'form').length,
      viewportMetaPresent: tags.some((tag) => !tag.closing && tag.name === 'meta' && String(tag.attrs.name).toLowerCase() === 'viewport'),
      provesRenderedVisibility: false,
      provesStockTruth: false,
      provesFormFunctionality: false,
    },
    blockers: [...new Set(blockers)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

function contentTypeEvidence(response) {
  const raw = response.headers.get('content-type') ?? '';
  const lowered = raw.toLowerCase();
  if (!lowered.includes('text/html')) throw new Error('content_type_not_html');
  const charset = lowered.match(/charset\s*=\s*([^;\s]+)/)?.[1]?.replace(/["']/g, '') ?? null;
  if (charset && charset !== 'utf-8' && charset !== 'utf8') throw new Error('charset_not_utf8');
  return { mime: 'text/html', charset: charset ?? 'not_declared' };
}

async function readBoundedBody(response, controller) {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    controller.abort();
    await response.body?.cancel().catch(() => {});
    throw new Error('body_too_large');
  }
  const chunks = [];
  let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('response_body_missing');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw new Error('body_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = Buffer.concat(chunks.map((value) => Buffer.from(value)), bytes);
  return result;
}

export async function fetchPage(config, fetchImpl = fetch) {
  if (!config || !ALLOWED_URLS.has(config.requestUrl)) throw new Error('url_not_allowlisted');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(config.requestUrl, {
      redirect: 'manual',
      headers: { accept: 'text/html', 'user-agent': 'Rosomaha fixed Bitrix category SEO audit/1.0' },
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error('redirect_rejected');
    if (response.status !== 200) throw new Error('http_status_not_200');
    if (response.url !== config.expectedFinalUrl) throw new Error('final_url_mismatch');
    const contentType = contentTypeEvidence(response);
    const body = await readBoundedBody(response, controller);
    let html;
    try {
      html = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      throw new Error('invalid_utf8');
    }
    return {
      id: config.id,
      requestUrl: config.requestUrl,
      finalUrl: response.url,
      statusCode: response.status,
      contentType,
      bytes: body.byteLength,
      sha256: sha256(body),
      evidence: parseCategoryHtml(html, config),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function comparePages(pages) {
  const comparisons = [];
  const blockers = [];
  const warnings = [];
  for (const group of [...new Set(PAGE_CONFIGS.map((config) => config.group))]) {
    const members = pages.filter((item) => PAGE_CONFIGS.find((config) => config.id === item.id)?.group === group);
    if (members.length < 2) continue;
    const baseline = members[0];
    const baselineSlugs = uniqueSortedSlugs(baseline.evidence.products);
    const baselinePrices = baseline.evidence.products.map((item) => `${item.identity}:${item.price}`).sort();
    const result = { group, baseline: baseline.id, members: [], exactSlugParity: true, exactPriceParity: true };
    for (const member of members.slice(1)) {
      const slugs = uniqueSortedSlugs(member.evidence.products);
      const prices = member.evidence.products.map((item) => `${item.identity}:${item.price}`).sort();
      const slugParity = exactSet(baselineSlugs, slugs);
      const priceParity = slugParity && exactSet(baselinePrices, prices);
      result.members.push({ id: member.id, slugParity, priceParity });
      if (!slugParity) {
        result.exactSlugParity = false;
        blockers.push(`${group}_variant_slug_mismatch`);
      }
      if (!priceParity) {
        result.exactPriceParity = false;
        blockers.push(`${group}_variant_price_mismatch`);
      }
    }
    comparisons.push(result);
  }
  return { comparisons, blockers: [...new Set(blockers)].sort(), warnings: [...new Set(warnings)].sort() };
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeTimestamp(now) {
  return now.toISOString().replace(/[-:.TZ]/g, '');
}

function fsyncDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

function writeExclusive(filePath, contents) {
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function replacePointer(directory, name, payload, nonce) {
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${name}.${nonce}.tmp`);
  writeExclusive(temporary, canonicalJson(payload));
  fs.renameSync(temporary, target);
  fsyncDirectory(directory);
}

export function saveReceipt(receipt, options = {}) {
  const directory = options.directory ?? REPORT_DIR;
  const now = options.now ?? new Date();
  fs.mkdirSync(directory, { recursive: true });
  const nonce = `${safeTimestamp(now)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fileName = `${safeTimestamp(now)}-bitrix-category-seo-${receipt.status}.json`;
  const filePath = path.join(directory, fileName);
  const contents = canonicalJson(receipt);
  writeExclusive(filePath, contents);
  fsyncDirectory(directory);
  const pointer = { receiptVersion: 1, file: fileName, sha256: sha256(Buffer.from(contents)), status: receipt.status };
  replacePointer(directory, 'latest.json', pointer, nonce);
  if (receipt.status === 'pass') replacePointer(directory, 'latest_pass.json', pointer, `${nonce}-pass`);
  return { filePath, pointer };
}

export async function runAudit(options = {}) {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const pages = [];
  const sourceFailures = [];
  for (const config of PAGE_CONFIGS) {
    try {
      pages.push(await fetchPage(config, fetchImpl));
    } catch (error) {
      sourceFailures.push({ id: config.id, errorCode: error instanceof Error ? error.message : 'unknown_error' });
    }
  }
  const pageBlockers = pages.flatMap((item) => item.evidence.blockers.map((code) => `${item.id}:${code}`));
  const pageWarnings = pages.flatMap((item) => item.evidence.warnings.map((code) => `${item.id}:${code}`));
  const comparison = sourceFailures.length === 0 ? comparePages(pages) : { comparisons: [], blockers: [], warnings: [] };
  const blockers = [...sourceFailures.map((item) => `${item.id}:${item.errorCode}`), ...pageBlockers, ...comparison.blockers];
  const warnings = [...pageWarnings, ...comparison.warnings];
  const status = sourceFailures.length > 0 ? 'source_unavailable' : blockers.length > 0 ? 'seo_mismatch' : 'pass';
  const receipt = {
    receiptVersion: 1,
    generatedAt: now.toISOString(),
    status,
    mode: 'public_read_only',
    readyForCmsDiff: status === 'pass',
    domains: {
      audited: 'https://rosomaha-rus.ru/',
      separateMainCatalog: 'https://xn--80aa8ahaki9a.site/',
      separateQuiz: 'https://rosomaha.site/',
      crossDomainMetricsOrConclusionsUsed: false,
    },
    scope: {
      exactUrlAllowlist: PAGE_CONFIGS.map((item) => item.requestUrl),
      automaticDiscovery: false,
      fixedTaxonomySetSource: 'repo_owned_product_taxonomy_2026-08-14',
    },
    taxonomyObservation: {
      observedAt: '2026-08-14',
      liveClassicContainsSixwheel: true,
      liveClassicMissingEger: true,
      livePickupContainsEger: true,
      businessCorrectnessConfirmed: false,
      meaning: 'Текущая публичная структура Bitrix расходится с проектной продуктовой картой и не принимается за норму автоматически.',
      followUpRequiredBeforeReclassification: true,
    },
    pages,
    sourceFailures,
    comparisons: comparison.comparisons,
    blockers: [...new Set(blockers)].sort(),
    warnings: [...new Set(warnings)].sort(),
    assertions: {
      noMutation: true,
      noBrowserClaims: true,
      noRedirectFollowed: true,
      cmsUnchanged: true,
      adsUnchanged: true,
    },
  };
  const saved = options.save === false ? null : saveReceipt(receipt, { directory: options.directory, now });
  return { receipt, saved };
}

async function main() {
  if (process.argv.length !== 2) throw new Error('arguments_not_supported');
  const result = await runAudit();
  console.log(`Bitrix category SEO baseline: ${result.receipt.status}`);
  console.log(`Проверено URL: ${result.receipt.pages.length}/${PAGE_CONFIGS.length}`);
  console.log(`Готовность к CMS dry-run: ${result.receipt.readyForCmsDiff ? 'да' : 'нет'}`);
  if (result.saved) console.log(`Квитанция: ${path.relative(PROJECT_ROOT, result.saved.filePath)}`);
  if (result.receipt.blockers.length > 0) console.log(`Блокеры: ${result.receipt.blockers.slice(0, 10).join(', ')}`);
  if (result.receipt.status !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Bitrix category SEO baseline ERROR: ${error instanceof Error ? error.message : 'unknown_error'}`);
    process.exitCode = 1;
  });
}
