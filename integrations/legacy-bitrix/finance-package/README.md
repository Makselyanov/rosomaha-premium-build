# Legacy Bitrix finance package

Self-contained source package for a native `https://rosomaha-rus.ru/finansirovanie/` page and its same-origin CRM proxy. It does not modify the React application, nginx configuration, the existing legacy bridge, or production.

Current state: package source and local contract tests only. It has not been installed, deployed, smoke-tested against CRM, or wired into the active Bitrix template.

## Package map

- `payload/webroot/finansirovanie/index.php` — Bitrix page include and finished public markup.
- `payload/webroot/finansirovanie/assets/finance.css` — page-scoped styles.
- `payload/webroot/finansirovanie/assets/finance-core.js` — pure calculator, contract, and receipt-gate functions.
- `payload/webroot/finansirovanie/assets/finance.js` — browser controller, live legal-document gate, immutable retry, and hard-conversion event.
- `payload/webroot/finansirovanie/config/products.v1.json` — versioned catalog snapshot.
- `payload/webroot/local/tools/rosomaha-finance-intake/index.php` — same-origin public endpoint.
- `payload/webroot/local/php_interface/include/rosomaha_finance_proxy.php` — request boundary, root-owned token reader, TLS upstream client, and response allowlist.
- `tests/proxy_contract_test.php` — PHP boundary and response contract tests; no HTTP calls.
- `tests/calculator_contract_test.mjs` — calculator, legal metadata, retry/receipt, browser secrecy, and catalog-source tests.
- `OPERATIONS.md` — preflight, install, template-link migration, verification, and rollback procedure.

## Fixed public/CRM contract

The browser calls only `/local/tools/rosomaha-finance-intake/index.php` on its own origin. It sends no cookies or credentials and never receives the CRM site token. The explicit filename avoids relying on a web-server directory-index rule.

The proxy accepts only:

- `GET` with no query string, files, or body, used for the active legal document;
- `POST application/json` up to 16 KiB with `X-Lead-Submission-ID` exactly equal to the body ID;
- requests whose host and `Origin` (or strict HTTPS `Referer` fallback) are `rosomaha-rus.ru`.

The proxy rejects all other methods, query parameters, uploads, unknown JSON keys, unpinned provenance, invalid IDs, and oversized requests. It constructs its own outbound headers and therefore never forwards browser cookies, `Authorization`, client IP headers, or arbitrary headers.

For POST, the PHP boundary reads the installed `products.v1.json` itself and requires an exact product-name/catalog-price pair plus one of the page's supported terms. Browser-edited prices and unknown products are rejected before CRM.

Outbound provenance is fixed to:

| Field/header | Fixed value |
| --- | --- |
| `Origin` | `https://rosomaha-rus.ru` |
| `source_site` | `rosomaha-rus.ru` |
| `source_form` | `credit_calculator` |
| `source_path` | `/finansirovanie/` |
| `consent_source` | `rosomaha_rus_credit` |
| CRM endpoint | `https://rosomaha.centrlp.ru/api/finance/public-intake` |

The token path can be set server-side with the `ROSOMAHA_FINANCE_TOKEN_FILE` PHP constant or PHP-FPM environment variable. The safe default is `/etc/rosomaha/finance-intake.token`. The proxy requires an absolute regular, non-symlink path outside the document root, root ownership, no group write/execute permission, no world permission, and a printable 32–512 byte token. A missing or unsafe token disables both legal metadata and submission.

TLS peer and hostname checks are mandatory, redirects are disabled, and only HTTPS is allowed. The proxy has no request/body/PII logging. It returns only an allowlisted JSON shape; upstream HTML, malformed JSON, internal deal/application IDs, and upstream error text are replaced with generic responses.

## Calculator and consent behavior

The only calculated amount is:

`requested principal = catalog price − down payment`

The selected term is carried as a preference. There is no lender rate, monthly-payment formula, repayment schedule, partner selection, approval prediction, document upload, or financial-partner handoff.

On load, the page fetches the current `personal_data_processing` document. It validates `version`, `title`, `text`, and `sha256`, recomputes the SHA-256 of the received text with Web Crypto, and enables the form only after an exact match. The fetched version is copied into `privacy_version`. A failed GET or integrity check keeps the form disabled. Resetting a failed submission fetches the legal document again, so a rotated version cannot be reused silently.

The first submit creates one frozen body string and one `lead_submission_id`. A retry resends those exact bytes and ID. Choosing “Изменить данные и создать новую отправку” discards the snapshot, fetches current legal metadata, and causes the next submit to receive a new ID.

The page emits `rosomaha:finance-hard-conversion` only when HTTP status is 200/201 and the safe JSON contains:

- `status: "ok"`;
- `lead_submission_id` exactly equal to the submitted ID;
- `receipt_id` matching the opaque `fin_[a-f0-9]{32}` contract;
- boolean `created` and `deduplicated` flags.

The event contains only the submission ID, opaque receipt, and those two flags—no name, phone, email, city, or comment. Binding this event to the already approved analytics counter/goal requires access to the active Bitrix template; this package does not invent a counter ID or goal name.

## Product truth and prefilling

`products.v1.json` declares its source and price semantics. Its entries are an exact snapshot of `src/data/products.ts#classicVariants`, not lender terms. The JS test compares every ID, name, slug, and price against that source and must pass immediately before packaging.

Catalog links can preselect a known entry with:

`/finansirovanie/?product=eger-1`

Only exact IDs from the versioned config are accepted; unknown values are ignored. Before production installation, the same snapshot must also be compared with the currently published Bitrix catalog. A mismatch blocks installation until the config is regenerated and versioned.

## Local tests

From `G:\mvp\rosomaha`:

```powershell
php integrations/legacy-bitrix/finance-package/tests/proxy_contract_test.php
node integrations/legacy-bitrix/finance-package/tests/calculator_contract_test.mjs
```

Both suites are read-only with respect to CRM and make no network requests.
