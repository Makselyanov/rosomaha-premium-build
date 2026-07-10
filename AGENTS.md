# Rosomaha workspace contract

## Project boundaries

- The main SEO site is `https://xn--80aa8ahaki9a.site/`.
- The Latin `https://rosomaha.site/` is a separate quiz/Marquiz funnel. Never
  merge its content, analytics, or lead conclusions with the main site.
- Yandex work is API-only unless the user gives new explicit browser
  permission. Use only the isolated `rosomaha-rus999` project credentials.
- For the main site, the hard lead goal is Metrika goal `517600157`
  (`crm_conversion`), fired only after CRM confirms the deal and submission id.
  Goal `517599639` is an older DOM form signal and must not be counted as a
  confirmed lead.

## Clean Git tree

1. Start every task with `git status --short`.
2. Treat existing changes as owned by another task until their origin is
   understood. Never discard or overwrite them to obtain a clean status.
3. Put temporary builds, downloads, screenshots, archives, and diagnostics only
   under ignored `.codex_tmp/` or `.local-artifacts/` paths.
4. Keep generated audit outputs under ignored `marketing-audits/` or
   `seo-reports/` paths.
5. Finish implementation work with a verified build, a focused commit, and a
   clean `git status --short`. If that is impossible, report the exact files and
   owner/blocker instead of leaving unexplained changes.

## Content Zavod and deployment safety

- Content Zavod writes its canonical server export to
  `/var/www/rosomaha/public/api/articles.json` and
  `/var/www/rosomaha/src/data/articles-cz/`.
- The local Git checkout can lag behind that export. Before every manual site
  build or deployment, merge the current server export into an isolated
  temporary worktree; do not overwrite the main local checkout just to build.
- A candidate release must contain every slug present in the canonical server
  export. Never deploy a candidate with fewer slugs or a missing existing slug.
- `scripts/server-release.sh` enforces this rule and must remain the only normal
  release switch. Do not bypass its content guard.
- After deployment, compare the canonical export and live
  `/api/articles.json`, verify all newly added article URLs, and confirm the
  production release symlink.

## Concurrent work

- CRM/content publication and site/SEO implementation are separate writers.
  CRM owns article export data; the site repository owns application code,
  templates, SEO metadata, and release tooling.
- If both streams changed the same article-export files, preserve the CRM export
  as content truth and reapply code/SEO changes around it in an isolated
  worktree.
- Do not let a build, audit, or deployment process write generated artifacts to
  tracked source paths unless those files are intentionally committed.
