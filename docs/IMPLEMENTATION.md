# Реализация приложения · 24.11.2026

Реализован local-first модульный монолит: HTTP/UI + SQLite + один управляемый worker Stockfish. Существующие зависимости использованы без установки новых. Главный запуск теперь `npm start` / `node index.js`, адрес по умолчанию http://127.0.0.1:3000. Node 24+ обязателен.

## Функциональные части

| Область | Реализация и фактический уровень |
|---|---|
| Профили / история | Несколько профилей, raw+PGN, stable profile:UUID IDs, idempotent upsert, quarantine невалидных/нестандартных партий |
| Chess.com | Profile/stats/archives/all months, последовательные запросы, timeout, 404/410, bounded retry 429/5xx/network, conditional ETag/Last-Modified, явный TLS verification |
| PGN | chess.js, SetUp/FEN, SAN/UCI, позиции до/после, реальный color/fullmove; comments/clocks и increment-aware thinking time |
| Stockfish | Собственный UCI transport поверх имеющегося WASM, буферизация разбитых строк, handshake, cp/mate/POV/PV/WDL, MultiPV позиции, Threads/Hash, depth/time/nodes limits, timeout/abort/terminate |
| Массовый анализ | Durable jobs SQLite, транзакционный claim, один worker, pause/resume/cancel/retry, per-game commit, позиционный cache с engine/options/history key; новое/вся выборка/IDs |
| Достоверность | Приведение scores к белым, затем к сделавшему ход; финальная позиция; mate отдельно; player-only quality/ACPL включая нули; явная provenance/version |
| Статистика | W/L/D/unknown, score rate, форматы/цвета/причины, рейтинг и месяцы, серии, длины/время/активные дни, фильтры и drill-down |
| Дебюты | PGN/ECO/Chess.com opening URL, fallback ограниченный справочник, частоты/результаты/качество/checkpoints 5/10/15/20, дерево до 24 полуходов; полной теоретической базы нет |
| Стадии / преимущество | Material-based heuristic, stage quality/time/errors; +1/+2/+3/+5/+10 после двух последовательных собственных ходов, conversion и missed mate |
| Тактика / позиции | Эвристические hanging/fork/pin/material/check признаки и pawn structure/king danger/development/center; не все тактические мотивы и не причинное объяснение |
| Эндшпили | Материальные типы, разно-/одноцветные слоны, качество/результат; нет tablebase доказательства |
| Время / сессии | Clocks/spent/median/buckets/pressure; live sessions/gap/timezone, порядковый номер игры, после W/L/D и heatmap |
| Навыки / рекомендации | Прозрачные показатели качества по контекстам, min N, локальные правила с примерами, сравнение периодов; нет популяционной нормализации/LLM |
| Тренировки | До 10 candidates/job, отдельный MultiPV поиск, gap≥.04 и depth≥8, хранение линии, интерактивные шаги/ответы, hints/reveal, attempts и повторение 1/2/4… дней |
| UI | 16 разделов, адаптивная вёрстка, реальные данные/empty/error/loading, сортировка/пагинация, доска/keyboard/flip/arrows/eval/PV/branching/PGN |
| Надёжность | SQLite WAL/FK/indexes, app singleton lock, внешние изменения инвалидируют кэш, backup API; оригинальные JSON/PGN не перезаписываются |

## Схема данных

Таблицы: `metadata`, `profiles`, `games`, `analyses`, `jobs`, `http_cache`, `position_cache`, `quarantine`, `puzzles`, `attempts`. Версия схемы `PRAGMA user_version=1`. Доменные документы вложены JSON, исходные API поля сохранены в game.raw. Индексы profile/time, profile/format/time, game analysis/time, job status/time. Несколько анализов партии сохраняются, для UI выбирается последний verified, иначе recovered. Полный нормализованный relational move warehouse для 100k партий не заявляется: аналитика личной истории использует in-memory cohort и требует дальнейшего профилирования на больших объёмах.

## HTTP API

| Методы | Назначение |
|---|---|
| GET /api/health, /api/bootstrap | Состояние, профили, настройки, режимы |
| POST /api/profiles | Добавить профиль, запустить проверку/синхронизацию |
| PATCH /api/settings | Валидированные параметры |
| GET /api/games | Фильтры, sort/direction, page/limit |
| GET /api/games/{id} | PGN, ходы и выбранный анализ |
| GET /api/games/{id}/pgn, /versions | Экспорт и реестр версий |
| POST /api/import | Локальный PGN, несколько Event блоков |
| GET /api/analytics | Метрики с общим фильтром и coverage/methodology |
| GET/POST /api/jobs | Статусы / создать sync, analysis или puzzles job |
| POST /api/jobs/{id}/pause,resume,cancel,retry | Управление заданием (каждое действие — отдельный URL) |
| POST /api/position | Ограниченный MultiPV анализ FEN; один interactive search одновременно |
| GET /api/puzzles | Задачи без раскрытия решений, статистика попыток |
| POST /api/puzzles/{id}/attempt,hint,solution | Проверка шагов, подсказка/решение |
| POST /api/backup | Согласованный SQLite snapshot |

Все game/job/puzzle запросы проверяют выбранный profile. Это разделение данных профилей одного владельца, не серверная авторизация между людьми. Bind loopback и Host/Origin/Content-Type/CSP ограничивают локальную поверхность. Значения SQL параметризованы, внешние строки экранируются в HTML. Для публичного сервера нужны полноценные auth/ownership/rate limiting и отдельный security review.

## Проведённые проверки

- `npm run check`: **10 модулей** (синтаксис активных модулей и frontend).
- `npm test`: **17/17 пройдено**, core/HTTP API/SQLite persistence. Проверяются PGN edge cases, SetUp с первым ходом чёрных, clocks/increment/missing, POV, mate0/missed mate, no-data, dedupe/isolation, filters/timezone, job state, API cache/404, CSRF, puzzle multi-step/repetition, полный обход подменённых архивов и повтор без дублей, external SQLite cache invalidation.
- `npm run test:engine`: **1/1 пройден**, один реальный engine, depth4, Threads1/Hash16, cp/PV/bestMove, terminate и реальная отмена поиска; короткая партия включает последнюю позицию.
- Ограниченный live Chess.com smoke: профиль, stats и список **7** архивов получены. Все месяцы массово не загружались.
- Полный worker flow: одна существующая короткая партия (**8 полуходов**) проанализирована и сохранена как verified. Пул из 16 процессов и весь массив не запускались.
- Puzzle worker: **10** исторических candidates проверены новым engine поиском; **6** задач прошли фильтр. Ошибок заданий не было. Реальные тренировочные попытки пользователя тестами не заполнялись: попытки проверялись в isolated memory DB.
- Browser QA: реальный обзор и данные 390 игр, список/переход, ходы/оценки/flip, легальная ветвь `e5`, training board/hint. В исходной видимой вкладке пользователь мог переходить по разделам; продолжение QA выполнялось в отдельной вкладке.
- Во время проверки устранён найденный stale-cache при двух server процессах: добавлены singleton lock, транзакционный claim и PRAGMA data_version invalidation.

Среда Codex блокировала sockets в sandbox (EACCES и недоступный порт 4317); HTTP тесты и предпросмотр прошли вне этого ограничения на порту 3000. Проверка сертификатов для внешнего HTTPS не отключалась. Первый failed assert ожидал две оценённые позиции в историческом PGN без последней оценки; корректное поведение сохраняет последнюю как missing, тест исправлен.

## Честные границы результата

Рабочее приложение и основные аналитические сценарии реализованы. Полная теория дебютов, десятки доказательных тактических мотивов, Syzygy, population/rating-adjusted skill normalization, Lichess и LLM coach отсутствуют. В UI структурные/тактические признаки названы эвристиками, старые scores — историческими, свои формулы не выдаются за Chess.com. Надёжность на 50k/100k партий не измерялась. Исходный audit остаётся историческим документом, его проценты после реализации не применяются.
