# Rosomaha

Фронтенд сайта [https://xn--80aa8ahaki9a.site/](https://xn--80aa8ahaki9a.site/), который размещается на сервере `90.156.168.115`.

## Стек

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

## Локальный запуск

Требования:

- Node.js 20+
- npm

Команды:

```sh
npm install
npm run dev
```

По умолчанию dev-сервер поднимается на `http://localhost:8080`.

## Продакшн-сборка

```sh
npm run build
```

Готовый статический сайт собирается в папку `dist/`.

## Актуальная схема продакшна

Проект больше не использует GitHub Pages. Боевой сайт работает напрямую с сервера `90.156.168.115`.

Текущая серверная структура:

- исходный проект: `/var/www/rosomaha`
- собранный фронтенд: `/var/www/rosomaha/dist`
- каталог релизов: `/var/www/rosomaha/_releases`
- активная версия сайта: `/var/www/rosomaha/current`

`nginx` отдает сайт не из `dist/`, а из симлинка `current`, который переключается на конкретный каталог релиза в `_releases/`.

## Деплой на сервер

Рекомендуемая схема публикации:

1. Обновить исходники проекта в `/var/www/rosomaha`.
2. На сервере выполнить сборку:

```sh
cd /var/www/rosomaha
npm run build
```

3. Создать новый релиз и переключить `current`:

```sh
/var/www/rosomaha/scripts/server-release.sh
```

Можно передать свой ярлык релиза:

```sh
/var/www/rosomaha/scripts/server-release.sh my-label
```

Скрипт возьмет содержимое `dist/`, создаст новый каталог в `_releases/` и обновит симлинк `current`.

## Откат релиза

Откат на предыдущий релиз:

```sh
/var/www/rosomaha/scripts/server-rollback.sh
```

Откат на конкретный релиз:

```sh
/var/www/rosomaha/scripts/server-rollback.sh <release_name>
```

Примеры имен релизов можно посмотреть так:

```sh
ls -1 /var/www/rosomaha/_releases
```

## Что важно для nginx

Так как это SPA на React Router, сервер должен:

- отдавать `index.html` для клиентских маршрутов;
- напрямую отдавать статику из `/assets`, `/media`, `/api`;
- не ломать `robots.txt` и `sitemap*.xml` в корне домена.

## Быстрая проверка после деплоя

После публикации полезно проверить:

- главную страницу `/`
- список статей `/articles`
- нужную карточку или статью
- `robots.txt`
- `sitemap-index.xml`

## Полезные материалы

- SEO-конфигурация и текущие замечания: `SEO_CONFIGURATION.md`
- исторический снимок продакшна на 19 марта 2026: `live-domain-2026-03-19/`
- серверные скрипты релиза и отката: `scripts/server-release.sh`, `scripts/server-rollback.sh`
