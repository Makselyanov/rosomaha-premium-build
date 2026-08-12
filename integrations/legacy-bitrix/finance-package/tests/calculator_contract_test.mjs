import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

let assertions = 0;

function truth(condition, message) {
  assertions += 1;
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual, expected, message) {
  assertions += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function throws(fn, message) {
  assertions += 1;
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testsDirectory, '..');
const repoRoot = path.resolve(testsDirectory, '../../../..');
const corePath = path.join(packageRoot, 'payload/webroot/finansirovanie/assets/finance-core.js');
const browserPath = path.join(packageRoot, 'payload/webroot/finansirovanie/assets/finance.js');
const configPath = path.join(packageRoot, 'payload/webroot/finansirovanie/config/products.v1.json');

await import(pathToFileURL(corePath).href);
const core = globalThis.RosomahaFinanceCore;
truth(core && typeof core === 'object', 'The browser core must expose its testable API.');

same(core.calculatePrincipal(1_300_000, 300_000), 1_000_000, 'Principal must be price minus down payment.');
same(core.calculatePrincipal(850_000, 0), 850_000, 'A zero down payment must be allowed.');
throws(() => core.calculatePrincipal(850_000, 900_000), 'Down payment above price must fail.');
throws(() => core.calculatePrincipal(850_000, 1.5), 'Fractional down payments must fail.');

same(core.normalizeRussianPhone('+7 (999) 123-45-67'), '79991234567', 'Russian phone normalization must match CRM.');
same(core.normalizeRussianPhone('8 999 123 45 67'), '79991234567', 'A leading 8 must normalize to 7.');
throws(() => core.normalizeRussianPhone('123'), 'Invalid phone numbers must fail.');

const generatedId = core.createSubmissionId(1_721_212_121_000, 'ABCDEF00-1111-2222-3333-ABCDEF000000');
same(generatedId, 'rosomaha-1721212121000-abcdef00-1111-2222-3333-abcdef000000', 'Submission IDs must match the CRM contract.');

const legalText = 'Действующий текст согласия.';
const legal = core.validateLegalMetadata({
  status: 'ok',
  privacy_document: {
    kind: 'personal_data_processing',
    version: 'public-finance-pd-v7',
    title: 'Согласие на обработку персональных данных',
    text: legalText,
    sha256: 'a'.repeat(64)
  }
});
same(legal.version, 'public-finance-pd-v7', 'The live legal version must be retained.');
truth(Object.isFrozen(legal), 'Legal metadata must be immutable after validation.');
throws(() => core.validateLegalMetadata({ status: 'ok' }), 'Missing legal metadata must fail closed.');

same(
  core.collectAttribution('?utm_source=yandex&utm_medium=cpc&unknown=drop&yclid=123'),
  { utm_source: 'yandex', utm_medium: 'cpc', yclid: '123' },
  'Only CRM attribution keys may be retained.'
);

const config = JSON.parse(await readFile(configPath, 'utf8'));
same(config.contract, 'rosomaha-finance-products/v1', 'The product config contract must be versioned.');
same(config.currency, 'RUB', 'The product config currency must be explicit.');
same(config.price_semantics, 'catalog_base_price', 'The price semantics must be explicit.');
truth(Array.isArray(config.products) && config.products.length > 0, 'The versioned product config must not be empty.');
same(core.productPrefill('?product=eger-1', config.products), 'eger-1', 'Known product IDs must prefill.');
same(core.productPrefill('?product=pickup-uaz', config.products), 'pickup-uaz-18', 'Legacy pickup IDs must prefill the renamed product.');
same(core.productPrefill('?product=unknown', config.products), null, 'Unknown product IDs must not prefill.');

const product = config.products.find((item) => item.id === 'eger-1');
const snapshot = core.buildSubmissionSnapshot({
  now: 1_721_212_121_000,
  randomValue: 'abcdef00-1111-2222-3333-abcdef000000',
  legal,
  product,
  name: 'Иван Петров',
  phone: '+7 (999) 123-45-67',
  email: '',
  city: 'Екатеринбург',
  applicantType: 'individual',
  financingType: 'credit',
  downPayment: '300000',
  termMonths: '36',
  comment: '',
  privacyAccepted: true,
  attribution: { utm_source: 'yandex' },
  honeypot: ''
});

truth(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.body), 'The retry snapshot and body must be immutable.');
same(snapshot.body.source_site, 'rosomaha-rus.ru', 'The browser source site must be pinned.');
same(snapshot.body.source_form, 'credit_calculator', 'The browser source form must be pinned.');
same(snapshot.body.source_path, '/finansirovanie/', 'The browser source path must be pinned.');
same(snapshot.body.consent_source, 'rosomaha_rus_credit', 'The browser consent source must be pinned.');
same(snapshot.body.privacy_version, legal.version, 'The submitted privacy version must come from live metadata.');
same(snapshot.body.phone, '79991234567', 'The snapshot must contain the normalized narrow phone field.');
truth(!Object.hasOwn(snapshot.body, 'email'), 'Empty optional fields must be omitted.');
same(snapshot.bodyJson, JSON.stringify(snapshot.body), 'The stored retry bytes must represent the frozen body exactly.');

const validReceipt = {
  status: 'ok',
  receipt_id: `fin_${'a'.repeat(32)}`,
  lead_submission_id: snapshot.id,
  created: true,
  deduplicated: false
};
truth(core.isHardConversionResponse(validReceipt, snapshot.id), 'Exact echo plus opaque receipt must be a hard conversion.');
truth(!core.isHardConversionResponse({ ...validReceipt, lead_submission_id: `${snapshot.id}-other` }, snapshot.id), 'A mismatched echo must not convert.');
truth(!core.isHardConversionResponse({ ...validReceipt, receipt_id: 'deal-123' }, snapshot.id), 'An internal-looking receipt must not convert.');
truth(!core.isHardConversionResponse({ ...validReceipt, created: 'true' }, snapshot.id), 'Malformed success flags must not convert.');
truth(!core.isHardConversionResponse({ ...validReceipt, deduplicated: true }, snapshot.id), 'Impossible success flags must not convert.');

const sourceProducts = await readFile(path.join(repoRoot, 'src/data/products.ts'), 'utf8');
const block = sourceProducts.match(/export const classicVariants:[\s\S]*?= \[([\s\S]*?)\n\];/);
truth(Boolean(block), 'The canonical classicVariants source block must be readable.');
const sourceEntries = [];
const entryPattern = /\{ id: '([^']+)', name: '([^']+)', slug: '([^']+)', price: ([0-9]+), priceFormatted: '[^']+' \}/g;
let match;
while ((match = entryPattern.exec(block[1])) !== null) {
  sourceEntries.push({ id: match[1], name: match[2], slug: match[3], price_rub: Number(match[4]) });
}
same(config.products, sourceEntries, 'The packaged product values must exactly match classicVariants; regenerate before install if this fails.');

const productsBlock = sourceProducts.match(/export const products: Product\[\] = \[([\s\S]*?)\n\];/);
truth(Boolean(productsBlock), 'The canonical products source block must be readable.');
const activeProductPrices = new Map();
const productEntryPattern = /^  \{\r?\n    id: '([^']+)',\r?\n    slug: '[^']+',[\s\S]*?^    basePrice: ([0-9]+),/gm;
while ((match = productEntryPattern.exec(productsBlock[1])) !== null) {
  activeProductPrices.set(match[1], Number(match[2]));
}
for (const variant of sourceEntries) {
  truth(activeProductPrices.has(variant.id), `The active product list must contain variant ${variant.id}.`);
  same(
    activeProductPrices.get(variant.id),
    variant.price_rub,
    `The active product and variant prices must match for ${variant.id}.`,
  );
}

const browserSource = await readFile(browserPath, 'utf8');
const coreSource = await readFile(corePath, 'utf8');
const publicPageSource = await readFile(path.join(packageRoot, 'payload/webroot/finansirovanie/index.php'), 'utf8');
truth(!/localStorage|sessionStorage/.test(browserSource + coreSource), 'The calculator must not persist PII or credentials in browser storage.');
truth(!/X-Rosomaha-Site-Token|Authorization/.test(browserSource + coreSource), 'The browser bundle must not know the server token or auth header.');
truth(!/annual[_-]?rate|interest[_-]?rate|monthly[_-]?payment/i.test(browserSource + coreSource), 'The calculator must not derive lender rates or monthly payments.');
truth(browserSource.includes("rosomaha:finance-hard-conversion"), 'A receipt-gated hard conversion event must be available.');
truth(!/TODO|draft|placeholder|Codex|implementation plan/i.test(publicPageSource), 'Public markup must contain only finished external copy.');

console.log(`calculator_contract_test: ${assertions} assertions passed`);
