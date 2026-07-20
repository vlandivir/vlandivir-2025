# Авторизация: кто и куда имеет доступ

Актуально на июль 2026. При изменении guard'ов или ключей — обновляйте этот файл.

## Кто имеет доступ

**Владелец (сессия Google).** Вход через `GET /auth/google` (OAuth code flow). После
входа проверяется email из `id_token`: он должен быть в allowlist
`ALLOWED_GOOGLE_EMAILS` (через запятую). Сейчас там: `vladimir.rybakov@gmail.com`.
Любой другой Google-аккаунт получает 403 при попытке входа.
Сессия — JWT в httpOnly-cookie `vl_session` на 30 дней, подпись `SESSION_SECRET`.
Выход: `GET /auth/logout`. Проверка: `GET /auth/me`.

**Машинные клиенты (скрипты, интеграции).** Секретные ключи в заголовках,
значения — в env (см. таблицу env ниже). URL-секретов больше нет.

## Механизмы (где в коде)

| Механизм | Файл | Поведение без доступа |
|---|---|---|
| `GoogleSessionGuard` | `src/auth/google-session.guard.ts` | Страницы (GET + Accept: html) — redirect на `/auth/google`; API — 401 |
| `EditAccessGuard` | `src/auth/edit-access.guard.ts` | 401. Пускает: сессия ИЛИ `x-map-api-key`/`x-reels-api-key` = `REELS_API_KEY` \|\| `MAP_API_KEY` \|\| `NOTE_API_KEY` |
| `canEdit()` (map-api) | `src/map-api.controller.ts` | Для `?force=1` в instagram-meta: сессия или ключ, иначе 401 |
| Локальные проверки ключей | `src/notes-api.controller.ts`, `src/notifications-api.controller.ts`, `src/mcp/mcp.controller.ts` | 401 |
| Подпись Telegram initData | `src/mini-app/mini-app.controller.ts` | Ошибка валидации |
| OAuth-модуль (вход/сессии) | `src/auth/auth.service.ts`, `src/auth/auth.controller.ts` | — |

## Матрица маршрутов

### Публичное (без авторизации)

| Что | Маршруты | Где обозначено |
|---|---|---|
| Статические страницы | `/`, `/home`, `/subs`, `/gpx-route-png`, `/files`, `/places` (+ статика `/shared`, `/mini-app`) | `src/main.ts` (useStaticAssets) |
| Share-страницы карты | `/places/point/:id`, `/places/track/:id` | `src/map-pages.controller.ts` |
| Чтение карты | `GET /map-api/points`, `/tracks`, `/tags`, `/resolve-google-link` | `src/map-api.controller.ts` (без guard) |
| Семантический поиск по карте | `GET /map-api/search?q=` | `src/map-api.controller.ts` (без guard); ищет по точкам/трекам с прикреплённым рилсом через эмбеддинги рилсов |
| Обновление Instagram-меты (без force) | `POST /map-api/{points,tracks}/:id/instagram-meta` | там же; окно 24 ч защищает от злоупотребления |
| Subs-инструменты | `/subs-api/*` (загрузка видео, транскрипция, рендер) | `src/subs.controller.ts` — **без авторизации, публичный инструмент** |
| Вход/выход | `/auth/google`, `/auth/google/callback`, `/auth/logout`, `/auth/me` | `src/auth/auth.controller.ts` |

### Только сессия Google (владелец)

| Что | Маршруты | Где обозначено |
|---|---|---|
| Записная книжка рилсов (страницы) | `GET /reels`, `GET /reels/:id` | `src/reels-pages.controller.ts` (`GoogleSessionGuard` / `requireSession`) |
| Дашборд почты (страница) | `GET /email` | `src/email-pages.controller.ts` |
| API почты | `GET/POST /email-api/*` (stats, messages, sync) | `src/email-api.controller.ts` (guard на классе) |

Старые секретные ссылки `/reels/<secret>[/<id>]` удалены: `/reels/<не-число>` →
redirect `/reels`, `/reels/<secret>/<id>` → 301 на `/reels/<id>` (дальше вход).

### Сессия ИЛИ машинный ключ (`EditAccessGuard`)

| Что | Маршруты | Заголовок для машин |
|---|---|---|
| Мутации карты | `POST/PATCH/DELETE /map-api/{points,tracks,tags}`, `POST /map-api/key-check` | `x-map-api-key` |
| Instagram-мета с `?force=1` | `POST /map-api/.../instagram-meta?force=1` | `x-map-api-key` |
| Чтение рилсов | `GET /reels-api/reels[...]`, `/search`, `/ask` | `x-reels-api-key` |
| Мутации рилсов | `POST/DELETE /reels-api/...` (создание, retry, теги, transcribe, vision, embed, key-check) | `x-reels-api-key` |

### Только машинные ключи / другие механизмы

| Что | Маршруты | Авторизация |
|---|---|---|
| Заметки из скриптов | `POST /notes-api/notes` | `x-note-api-key` = `NOTE_API_KEY` |
| Уведомления | `POST /notifications-api/messages` | `x-notification-api-key` = `NOTE_API_KEY` |
| MCP-сервер | `POST /mcp` | публичные инструменты (карта) — без ключа; приватные (дневник, рилсы) — `Authorization: Bearer <MCP_API_KEY>` (+ `X-Chat-Id` для дневника) |
| Telegram Mini App | `GET /mini-app-api/*` | подпись `initData` токеном бота |
| Telegram webhook | `POST /telegram-bot` | безопасность на стороне Telegram (токен бота при setWebhook) |

## Секреты (env)

Локально — `.env`; прод — GitHub secrets → build-args (`.github/workflows/deploy-production.yml`) → `Dockerfile` ARG/ENV.

| Переменная | Что даёт |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth-клиент Google (консоль: проект с consent screen) |
| `SESSION_SECRET` | Подпись JWT сессий и state |
| `ALLOWED_GOOGLE_EMAILS` | Allowlist владельцев (через запятую) |
| `MAP_API_KEY` | Машинный ключ редактирования карты и рилсов |
| `NOTE_API_KEY` | Ключ notes/notifications API; принимается и как fallback ключа карты |
| `REELS_API_KEY` | Необязательный отдельный ключ рилсов (не задан — используется `MAP_API_KEY`) |
| `MCP_API_KEY` | Приватные инструменты MCP |
| `EMAIL_ACCOUNTS` | App-пароли IMAP (не для HTTP-доступа) |
| ~~`REELS_PAGE_KEY`~~ | Удалён (июль 2026) — секретные URL рилсов больше не работают |

## Как дать доступ ещё одному человеку

1. Добавить email в `ALLOWED_GOOGLE_EMAILS` в `.env` и `gh secret set ALLOWED_GOOGLE_EMAILS`.
2. Задеплоить. Всё — человек входит своим Google-аккаунтом.
