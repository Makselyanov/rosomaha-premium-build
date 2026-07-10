# Rosomaha API-only policy

For Rosomaha marketing audits, use API/local scripts only.

- Do not open Yandex UI.
- Do not open Google/Search Console UI.
- Do not automate the owner's browser.
- Yandex Direct login is `rosomaha-rus999`.
- Main catalog site is `xn--80aa8ahaki9a.site`.
- Latin `rosomaha.site` is the quiz/Marquiz funnel.
- Treat Direct conversions, calls, messengers, quiz opens, and soft goals as non-lead signals.
- Hard catalog lead goal: Metrika counter `107139619`, goal `517599639`.
- Hard quiz lead goal: Metrika counter `105918356`, goal `496461698`.
- Use `npm run api:doctor` before audits.
- Use `npm run audit:api-only` for the recurring audit artifact.
- If GSC lacks `GSC_REFRESH_TOKEN`, report `missing_project_gsc_oauth_config`; do not use browser OAuth during API-only work.
