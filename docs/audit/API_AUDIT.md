# Реестр API и контрактов

## Собственный Backend API

**Существующих HTTP методов: 0.** Нет HTTP listener/router/framework, auth middleware, controllers и frontend fetch к собственному серверу. package.json содержит только chess.js и Stockfish wrapper; index.js — CLI. Поэтому method/url/request/response/auth/validation/tables/frontend consumers/tests/status для собственных endpoints — NOT_APPLICABLE, а не «реализовано». Неиспользуемых, дублированных или незавершённых HTTP endpoints не обнаружено. Раздел R8-* матрицы связан с этим пустым реестром.

Наличие серверной вычислительной логики (analyzeGame/generateSummary) не означает наличие Backend API. Статические HTML уже включают результаты, не загружают JSON с сервера и не могут управлять импортом.

## Исходящие внешние методы

| HTTP и URL | Функция / потребитель | Вход / выход | Авторизация и валидация | Ошибки / проверки / статус |
|---|---|---|---|---|
| GET https://api.chess.com/pub/player/{username}/games/archives | getArchives, lib/chess-api.js:1–7; main:15 | username без кодирования -> data.archives | Public API; локальной проверки username и ответа нет | !ok -> Error(status); реальный HTTP не проверен; mock success/404/429/503; IMPLEMENTED_UNVERIFIED |
| GET URL из archives, обычно /pub/player/{username}/games/{YYYY}/{MM} | getGamesForMonth, :9–14; main:29 | archiveUrl -> data.games | URL принимается произвольным параметром, hostname не проверен; пока только trusted API вызов | !ok -> Error(status); нет timeout/retry/schema; IMPLEMENTED_UNVERIFIED |
| GET /pub/player/{username} | Потребителей нет | Требуется профиль/avatar/identity | Не реализовано | NOT_IMPLEMENTED |
| GET /pub/player/{username}/stats | Потребителей нет | Требуются current/best/record по форматам | Не реализовано | NOT_IMPLEMENTED |

SQL таблицы не используются ни в одном методе. JSON кэш сохраняется file-utils. Ответ games сохраняется как полный массив объектов, envelope и response headers не сохраняются. Архивы не сохраняются. API fetch делает последовательные два запроса; parallel engine workers не равны parallel HTTP requests. Распознаваемый contact User-Agent не задаётся; нельзя утверждать, что fetch не отправляет вообще никакого стандартного User-Agent. 404/429/503 одинаково прерывают запуск, без Retry-After/backoff и retry budget. fetch reject для сетевой ошибки доходит до main catch. Таймаут приложения отсутствует; системные/транспортные таймауты могут существовать, но их политика не задана проектом.

Кэш существует на уровне наличия файла: при FORCE_REFRESH=false текущий месяц никогда не обновляется, даже если появляются новые партии. FORCE_REFRESH=true полностью перезаписывает. Список archives запрашивается всегда, что блокирует offline использование кэша при отказе сети. Пустой archives приводит к lastArchive=undefined и .split ошибке (main:16–17). Неверная схема response.games не валидируется, games.length может упасть. Сортировка main:40–47 смотрит game.headers.Date, хотя raw games не имеют headers: фактически comparator возвращает 0.

## Внешний документированный контракт

Проверена официальная [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api): публичный read-only интерфейс, возможны 429 при параллельных запросах; предусмотрены cache headers и рекомендация узнаваемого User-Agent с контактами. Текущий клиент этих механизмов не реализует. Публичность данных не заменяет решение об условиях дальнейшего распространения результатов: область использования/публикации в задании не задана. Конкретный rate limit в RPS не придумывается. Сеть приложения в аудите не использовалась; чтение официальной документации не подтверждает доступ к endpoint из рабочего Node runtime.

## Рекомендуемый будущий контракт (не существует сейчас)

| Группа | Предлагаемые методы | Обязательные правила / задачи |
|---|---|---|
| Profiles | POST/GET /profiles, GET/PATCH /profiles/{id} | Проверка membership/owner, normalized username, profile+stats snapshot, B11 |
| Sync | POST /profiles/{id}/sync-jobs, GET /sync-jobs/{id} | Durable job ID, idempotency, progress, errors, checkpoint, B06/B08 |
| Games | GET /games, GET /games/{id}, GET /games/{id}/pgn | Единый typed фильтр, cursor pagination, limit cap, no raw payload in list, B05/B10/B25 |
| Analysis | POST /analysis-jobs, GET /analysis-jobs/{id}, POST /analysis-jobs/{id}/pause/resume/cancel | Выбранные IDs/cohort, preset/version, dedupe lease; recovery, B07/B08 |
| Game review | GET /games/{id}/analysis?run_id=... | Typed cp/mate/POV, coverage, PV/clocks и критические моменты, B01/B03/B10 |
| Analytics | GET /analytics/{metric} | Период/format/profile/version, N/missing/formula, drill-down на IDs, B09/B25 |
| Training | GET /puzzles, POST /training-attempts | Авторизация, разделение задач/решений, reproducible evidence, B24 |

Эти URL — проектное предложение. Не выбирать framework/ORM только ради аудита; существующий стек вычислений пригоден. При локальном single-user режиме bind loopback и локальная модель доступа; при сетевом multi-user режиме обязательны auth, owner-scoped queries и лимиты ресурсоёмких jobs. API тесты нужны до публичного expose.
