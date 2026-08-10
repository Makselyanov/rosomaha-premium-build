# Installation and rollback runbook

This runbook is intentionally not an execution receipt. No production access, network call, browser action, template edit, cache clear, or deployment was performed while creating the package.

## Release blockers

Installation must stop until all of the following are available and verified:

1. The exact Bitrix document root, active `SITE_ID`, and active template ID for `rosomaha-rus.ru`.
2. Read/write access to the complete active template and a recoverable backup location outside the document root.
3. The existing CRM site token delivered through an approved secret channel and already represented by the tenant's `finance_public_intake.site_token_sha256` setting. Do not create an unrelated token.
4. The current active general `personal_data_processing` legal document in CRM.
5. A comparison of `products.v1.json` with the currently published Bitrix product prices.
6. The existing analytics counter ID and approved hard-lead goal name, if analytics binding is required.

The package does not contain the active Bitrix footer/template, so it cannot safely identify or replace the two ABC anchors. Their migration is explicitly blocked until the full active template is accessible. No ABC site or representative needs to be opened or contacted.

## Preflight on a release copy

Run from a clean release copy of the Rosomaha repository, before copying anything to the server:

```powershell
php integrations/legacy-bitrix/finance-package/tests/proxy_contract_test.php
node integrations/legacy-bitrix/finance-package/tests/calculator_contract_test.mjs
php -l integrations/legacy-bitrix/finance-package/payload/webroot/finansirovanie/index.php
php -l integrations/legacy-bitrix/finance-package/payload/webroot/local/tools/rosomaha-finance-intake/index.php
php -l integrations/legacy-bitrix/finance-package/payload/webroot/local/php_interface/include/rosomaha_finance_proxy.php
```

The catalog comparison test is a hard gate. If `classicVariants` changed, update `products.v1.json`, increment `catalog_version`, review the public prices, and rerun the test. Do not add lender rates or estimated payments.

## Identify and back up the exact Bitrix targets

On the server, set task-specific variables only after resolving the real paths:

```bash
export ROSOMAHA_DOCROOT=/absolute/path/to/rosomaha-rus-document-root
export ROSOMAHA_PACKAGE=/absolute/path/to/release/integrations/legacy-bitrix/finance-package
export ROSOMAHA_BACKUP=/var/backups/rosomaha-finance/2026-08-10-before-install
test "$(realpath "$ROSOMAHA_DOCROOT")" = "$ROSOMAHA_DOCROOT"
test -f "$ROSOMAHA_DOCROOT/bitrix/header.php"
test -f "$ROSOMAHA_DOCROOT/bitrix/footer.php"
```

Confirm the site's active template through Bitrix site settings, then set and resolve it:

```bash
export ROSOMAHA_TEMPLATE=/absolute/path/to/the-active-template
test "$(realpath "$ROSOMAHA_TEMPLATE")" = "$ROSOMAHA_TEMPLATE"
test "$ROSOMAHA_TEMPLATE" != "$ROSOMAHA_DOCROOT"
```

Create a backup directory outside the document root. Back up every active-template file containing an ABC link and any destination file that already exists. If any package destination exists and is not an earlier verified installation of this exact package, stop instead of overwriting it.

The package destinations are exactly:

```text
/finansirovanie/index.php
/finansirovanie/assets/finance.css
/finansirovanie/assets/finance-core.js
/finansirovanie/assets/finance.js
/finansirovanie/config/products.v1.json
/local/tools/rosomaha-finance-intake/index.php
/local/php_interface/include/rosomaha_finance_proxy.php
```

## Provision the server-only token file

Determine the PHP-FPM worker group, then create the default secret location outside the webroot:

```bash
export ROSOMAHA_PHP_GROUP=www-data
sudo install -d -o root -g "$ROSOMAHA_PHP_GROUP" -m 0750 /etc/rosomaha
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0640 /dev/null /etc/rosomaha/finance-intake.token
sudoedit /etc/rosomaha/finance-intake.token
sudo stat -c '%U %G %a %n' /etc/rosomaha/finance-intake.token
```

Paste only the already coordinated CRM site token in `sudoedit`. Do not put it in a command line, URL, shell history, repository, webroot, PHP page, browser bundle, log, or chat. The required ownership/mode result is root, the PHP-FPM group, and `640` (or stricter while still readable by PHP-FPM).

If policy requires another outside-webroot location, define only the path—not the token—in the PHP-FPM pool:

```ini
env[ROSOMAHA_FINANCE_TOKEN_FILE] = /approved/outside-webroot/finance-intake.token
```

Restart/reload PHP-FPM only through the site's approved deployment procedure after validating its configuration. The default `/etc/rosomaha/finance-intake.token` needs no constant or environment override.

## Install the package files

First prove none of the seven destinations will be silently overwritten. Record which parent directories already exist. Create only missing directories; do not change ownership or mode on a pre-existing Bitrix directory. Then install files individually; do not use `--delete` or a broad document-root sync.

```bash
test -d "$ROSOMAHA_DOCROOT/finansirovanie/assets" || sudo install -d -o root -g "$ROSOMAHA_PHP_GROUP" -m 0755 "$ROSOMAHA_DOCROOT/finansirovanie/assets"
test -d "$ROSOMAHA_DOCROOT/finansirovanie/config" || sudo install -d -o root -g "$ROSOMAHA_PHP_GROUP" -m 0755 "$ROSOMAHA_DOCROOT/finansirovanie/config"
test -d "$ROSOMAHA_DOCROOT/local/tools/rosomaha-finance-intake" || sudo install -d -o root -g "$ROSOMAHA_PHP_GROUP" -m 0755 "$ROSOMAHA_DOCROOT/local/tools/rosomaha-finance-intake"
test -d "$ROSOMAHA_DOCROOT/local/php_interface/include" || sudo install -d -o root -g "$ROSOMAHA_PHP_GROUP" -m 0750 "$ROSOMAHA_DOCROOT/local/php_interface/include"

sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0644 "$ROSOMAHA_PACKAGE/payload/webroot/finansirovanie/index.php" "$ROSOMAHA_DOCROOT/finansirovanie/index.php"
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0644 "$ROSOMAHA_PACKAGE/payload/webroot/finansirovanie/assets/finance.css" "$ROSOMAHA_DOCROOT/finansirovanie/assets/finance.css"
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0644 "$ROSOMAHA_PACKAGE/payload/webroot/finansirovanie/assets/finance-core.js" "$ROSOMAHA_DOCROOT/finansirovanie/assets/finance-core.js"
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0644 "$ROSOMAHA_PACKAGE/payload/webroot/finansirovanie/assets/finance.js" "$ROSOMAHA_DOCROOT/finansirovanie/assets/finance.js"
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0644 "$ROSOMAHA_PACKAGE/payload/webroot/finansirovanie/config/products.v1.json" "$ROSOMAHA_DOCROOT/finansirovanie/config/products.v1.json"
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0644 "$ROSOMAHA_PACKAGE/payload/webroot/local/tools/rosomaha-finance-intake/index.php" "$ROSOMAHA_DOCROOT/local/tools/rosomaha-finance-intake/index.php"
sudo install -o root -g "$ROSOMAHA_PHP_GROUP" -m 0640 "$ROSOMAHA_PACKAGE/payload/webroot/local/php_interface/include/rosomaha_finance_proxy.php" "$ROSOMAHA_DOCROOT/local/php_interface/include/rosomaha_finance_proxy.php"
```

Run `php -l` against the three installed PHP files as the production PHP version. Confirm the direct include path returns 404, the proxy endpoint has no CORS allow-origin header, and no web route can read `/etc/rosomaha/finance-intake.token`.

## Replace the two ABC anchors only after template access exists

Search only the verified active template, not every tenant or unrelated site:

```bash
rg -n --glob '*.php' --glob '*.html' 'https?://(www\.)?abc-cred\.ru' "$ROSOMAHA_TEMPLATE"
```

The change is allowed only when the result identifies exactly two finance CTA anchors in the active template. If the count is not exactly two, or an occurrence is script/config/content rather than an anchor `href`, stop for review.

For each containing file:

1. Preserve its relative path in `$ROSOMAHA_BACKUP` and copy the complete file there with metadata.
2. Record its SHA-256 before editing.
3. Replace only the two verified ABC `href` values with `/finansirovanie/`; retain the surrounding markup, visible CTA text, classes, tracking attributes, and accessibility text.
4. Re-run the scoped search and require zero ABC URLs in the active template.
5. Inspect both resulting anchors and require exactly the intended `/finansirovanie/` targets.
6. Run `php -l` on every changed PHP template file.
7. Clear only the affected Bitrix managed/template cache through the site's approved mechanism.

Do not run a blind regular-expression replacement, edit a dormant template, touch the separate React footer, or claim both links are replaced without rendered public verification.

## Analytics binding

After the active template and its existing analytics initialization are known, bind the approved hard-lead goal to the `rosomaha:finance-hard-conversion` browser event. Use the existing counter ID and existing approved goal name; do not introduce guessed identifiers. Send only `receiptId`, `leadSubmissionId`, `created`, and `deduplicated` if the analytics policy permits them. Never bind a goal to page view, product selection, calculator input, consent click, submit click, HTTP attempt, or an unverified response.

## Post-install verification

These checks require explicit production/network authorization and were not run for this package:

1. GET the proxy with `Origin: https://rosomaha-rus.ru`, no query/body/cookies, and confirm status 200 plus the current legal version/text/hash only.
2. Confirm GET with a query, POST without JSON, an `OPTIONS` request, a foreign Origin, an upload, and an oversized body all fail with the documented 4xx status and JSON only.
3. Load `/finansirovanie/` in the active site and confirm header/footer integration, responsive layout, keyboard operation, legal fail-closed behavior, no console errors, and no token/auth value in HTML, JS, storage, or network responses.
4. Confirm each known `?product=<id>` prefill uses the versioned catalog price and an unknown ID is ignored.
5. Use an owner-approved real test contact only if creating a real CRM lead is authorized. Confirm the provider returns 200/201, exact echoed ID, and opaque receipt; independently read back the resulting CRM record. A button click or local success message is not proof.
6. Confirm one hard-conversion goal appears only after that receipt-gated success, with no PII in its parameters.
7. Confirm both rendered former ABC CTAs point to `/finansirovanie/` and no active footer/template link still points to ABC.

## Rollback

Rollback uses the recorded pre-install hashes and backups. First resolve and re-check `$ROSOMAHA_DOCROOT`, `$ROSOMAHA_TEMPLATE`, and `$ROSOMAHA_BACKUP`; never delete through an empty, unresolved, or document-root-wide variable.

1. Put the site into its approved maintenance mode if required.
2. Restore the complete backed-up active-template files to their original relative paths and verify their recorded pre-change hashes.
3. Remove only the seven exact package files listed above, and only after confirming each current hash belongs to the installed package. Do not recursively delete `local`, `local/php_interface`, or the document root.
4. Remove the now-empty `finansirovanie/assets`, `finansirovanie/config`, `finansirovanie`, and `local/tools/rosomaha-finance-intake` directories only if each is empty. Leave pre-existing parent directories intact.
5. Remove the analytics event binding added for this page and restore the backed-up template version.
6. Clear only the affected Bitrix cache and exit maintenance mode.
7. Independently verify `/finansirovanie/` and the proxy are absent (or restored to the prior known state) and both original template links are restored.
8. Keep `/etc/rosomaha/finance-intake.token` until the CRM-side token is rotated/revoked through the coordinated secret procedure. Removing the file alone does not revoke the CRM credential. After revocation is confirmed, remove that exact file and its empty `/etc/rosomaha` directory if nothing else uses it.

If any installed file has changed since installation, stop and review the diff instead of overwriting or deleting it.
