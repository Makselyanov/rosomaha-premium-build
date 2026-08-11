# SEO Runbook

## Access

- Site: `https://xn--80aa8ahaki9a.site/`
- Yandex Webmaster secrets: `.env.seo.local`
- Required variables:
  - `YANDEX_WEBMASTER_CLIENT_ID`
  - `YANDEX_WEBMASTER_TOKEN`
  - `YANDEX_WEBMASTER_HOST_URL`
  - `YANDEX_WEBMASTER_USER_ID`
  - `YANDEX_WEBMASTER_HOST_ID`
  - `YANDEX_WEBMASTER_TOKEN_EXPIRES_AT`

## Local commands

- Build with SEO assets and prerender:
  - `npm run build`
- Generate Yandex SEO report:
  - `npm run seo:report`

## Report storage

- Operational SEO report:
  - `seo-reports/latest-yandex-webmaster-report.md`
- Monthly client reports:
  - `seo-reports/monthly/YYYY-MM-seo-report.md`
- Monthly report template:
  - `seo-reports/monthly/MONTHLY_REPORT_TEMPLATE.md`

## What the build now does

- Regenerates:
  - `public/sitemap.xml`
  - `public/sitemap-models.xml`
  - `public/sitemap-applications.xml`
  - `public/sitemap-articles.xml`
  - `public/sitemap-index.xml`
- Prerenders route-specific HTML for:
  - main pages
  - product pages
  - application pages
  - article pages

This matters because search bots must receive correct `title`, `description`, `canonical`, Open Graph and JSON-LD from raw HTML, not only after React hydration.

## Current known SEO risks

- `https://rosomaha-rus.ru/` is a separate active commercial Bitrix site, not a legacy domain or an automatic redirect candidate.
  - Track its availability, indexing, queries, traffic sources and CRM conversion path independently from `xn--80aa8ahaki9a.site` and `rosomaha.site`.
  - Monitor duplicate and cannibalization risks, but do not merge metrics or infer ownership of a query, visit or lead from another domain.
  - Do not change redirects, DNS, robots, sitemap, canonical tags or content ownership until the site's current role, data owner, traffic sources and conversion path are proved and a complete URL map has been reviewed.
  - Any later migration or path-to-path `301` decision requires a separate evidence-first approval and a reversible full release cycle; never redirect every URL to the homepage.
  - Public product pages currently submit lead data to the external endpoint `https://sam.myenvy.ru/integrations/php/sobeyko2008/EnvySend.php`, not to a same-domain Bitrix handler. Treat this as a separate conversion dependency and verify delivery into CRM before attributing any Bitrix lead drop to SEO or indexing.
- Yandex has indexed parameter and trailing-slash variants beyond the canonical sitemap set.
  - Keep tracking/filter parameters in `Clean-param`.
  - Production nginx must redirect non-root trailing-slash routes to their no-slash canonical.
- Yandex diagnostic `NOT_MOBILE_FRIENDLY` is still active even though current responsive smoke tests pass.
  - Recheck it after the updated HTML and priority routes are recrawled; do not treat the recommendation as closed until Webmaster clears it.
- Google Search Console OAuth can be revoked independently of the saved config.
  - `invalid_grant` requires a new project-specific refresh token before current Google positions can be confirmed.
- The OAuth token expires every 6 months.
  - Refresh OAuth and update `.env.seo.local` before expiry.

## Post-deploy checks

- Open:
  - `/`
  - `/catalog`
  - `/articles`
  - one article URL
  - one product URL
- Confirm in raw HTML:
  - correct `<title>`
  - correct `canonical`
  - route-specific `og:url`
  - route-specific `og:image`
- Run:
  - `npm run seo:report`
  - Confirm the report contains numeric `TOTAL_SHOWS`, `TOTAL_CLICKS`, and average positions for popular Yandex queries.

## Safe automatic actions

- Rebuild sitemaps.
- Rebuild prerendered route HTML.
- Submit important updated URLs for recrawl in Yandex Webmaster after release.

## Actions that still need judgment

- Rewriting page copy for search intent.
- Creating new article clusters.
- Changing URL structure.
- Removing or merging pages.
