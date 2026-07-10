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

- Yandex diagnostic `NOT_IN_SPRAV` is active.
  - This is not a code bug.
  - The site should also be added or confirmed in Yandex Business.
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

## Safe automatic actions

- Rebuild sitemaps.
- Rebuild prerendered route HTML.
- Submit important updated URLs for recrawl in Yandex Webmaster after release.

## Actions that still need judgment

- Rewriting page copy for search intent.
- Creating new article clusters.
- Changing URL structure.
- Removing or merging pages.
