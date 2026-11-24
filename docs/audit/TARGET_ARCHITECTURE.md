# Предлагаемая целевая архитектура

Это проектное предложение, не описание уже реализованных компонентов. Никаких изменений приложения, миграций или установок в аудите не выполнено. Сохраняем Node.js/chess.js/Stockfish и накопленные raw/PGN; наращиваем надёжность модульного монолита с отдельным процессом worker. Микросервисы и отдельный брокер не требуются на старте.

## Сохранить, изменить, создать

| Компонент | Решение | Обоснование |
|---|---|---|
| chess.js | Сохранить | PGN/правила подтверждены; исправлять использование начальной позиции, не переписывать шахматные правила |
| Raw JSON и исходные PGN | Сохранить неизменными | Восстановление партий и повторная нормализация; 390 партий уже доступны |
| Chess.com adapter | Доработать | Малый модуль с двумя корректно оформленными URL; добавить profile/stats, HTTP policy и валидацию |
| generateSummary | Сохранить идею чистых функций, переработать формулы | Можно воспроизводить и тестировать без движка; текущие знаменатели/attribution неверны |
| HTML reporter | Сохранить как экспорт, исправить escaping/графики | Независим от сервера, пригоден для offline отчётов |
| Stockfish wrapper | Сохранить условно, закрыть адаптером | Реальный запуск подтверждён; lifecycle/framing/timeout требуют тестов. Замена на native — только по измерению |
| Самописный pool/main/analyzer | Существенный рефакторинг отдельной задачей | Явный ownership процессов, bounded concurrency, domain contracts, отделение парсинга/оценки/классификации |
| Storage / jobs | Создать | SQLite и транзакции для локального режима, durable job/lease/run schema |
| Backend API / интерактивный frontend | Создать | Сейчас отсутствуют. Framework выбрать по объёму, компетенциям и модели установки |
| Analytics modules / recommendations / training | Создать | Числовой engine score не заменяет эти подсистемы |

SQLite — минимальная новая технология для транзакций/индексов/локальной поставки. PostgreSQL — при подтверждённом серверном multi-user доступе или высокой write concurrency. Redis/RabbitMQ добавлять только при обоснованной потребности нескольких хостов. TypeScript допускается постепенно для контрактов, не требуется тотальная миграция прежде исправления P0. Новый chart/chessboard UI выбирать после backend DTO и интерактивного review прототипа. LLM для рекомендаций необязательна: сначала объяснимые правила с evidence и privacy contract.

```mermaid
flowchart LR
    UI[Интерактивный UI] --> API[Локальный или серверный API]
    CLI[CLI и HTML экспорт] --> Domain[Доменные сервисы]
    API --> Domain
    Domain --> DB[(SQLite или PostgreSQL)]
    Domain --> Raw[(Исходные API snapshots и PGN)]
    Domain --> Jobs[Durable jobs и leases]
    Jobs --> Worker[Worker с лимитом ресурсов]
    Worker --> PGN[PGN нормализация chess.js]
    Worker --> Engine[Stockfish adapter и pool]
    Engine --> Cache[(Position analysis cache)]
    Worker --> DB
    Domain --> Analytics[Версионированные метрики]
    Analytics --> DB
    Analytics --> Features[Тактика позиции время сессии]
    Features --> Advice[Навыки рекомендации задачи]
```

## Импорт

```mermaid
sequenceDiagram
    participant C as UI или CLI
    participant S as Sync service
    participant A as Chess.com
    participant D as Storage
    C->>S: Создать idempotent sync job
    S->>A: Profile и stats и archives
    S->>D: Сохранить snapshot и список месяцев
    loop Каждый доступный месяц, запросы последовательно
        S->>A: Conditional GET с timeout и retry budget
        A-->>S: Games или 304 или ошибка
        S->>D: Raw snapshot, upsert games, checkpoint
    end
    S-->>C: Progress и coverage и last success
```

Обновлять активные месяцы по cache policy, неизменившиеся завершённые архивы подтверждать conditional GET; неизменность нельзя считать гарантией API навсегда. Партии хранить по source+UUID, fallback identity документировать. Не терять raw при невалидном PGN: карантин и per-game error. Сначала определяем rules/SetUp/FEN, сохраняем обе стороны, timestamps UTC и clocks.

## Анализ

```mermaid
flowchart TD
    Request[Выбор профиля периода games и preset] --> Job[Создать job с idempotency key]
    Job --> Lease[Worker lease и heartbeat]
    Lease --> Normalize[Валидировать PGN и начальный FEN]
    Normalize --> Positions[Все позиции включая финальную]
    Positions --> Cache{Совпадает engine build options и state}
    Cache -->|Да| Typed[Типизированные результаты]
    Cache -->|Нет| Search[Ограниченный Stockfish поиск]
    Search --> Typed
    Typed --> Classify[POV loss mate category features]
    Classify --> Commit[Транзакция и checkpoint]
    Commit --> Next{Есть партии}
    Next -->|Да| Lease
    Next -->|Нет| Done[Job complete с coverage]
    Search --> Failure[Ошибка timeout restart retry budget]
    Failure --> CommitError[Durable error и возможность повтора]
```

Один engine выполняет одну задачу поиска в момент времени. CPU budget ≥ workers*Threads плюс reserve; Hash и RSS budget отдельно. Cancel должен прерывать go, корректно завершать/возвращать engine и фиксировать статус; pause останавливает выдачу новых задач и сохраняет checkpoint, не теряет результат уже завершённого поиска. Lease expiry позволяет recovery без двойной записи. Unique job/game/run и транзакционный commit обеспечивают идемпотентность.

## Статистика и расширения

```mermaid
flowchart LR
    Filter[Единый фильтр и cohort] --> Query[Индексированная выборка]
    Query --> Coverage[Проверка версии и полноты]
    Coverage --> Metric[Чистая формула version]
    Metric --> Aggregate[Кэш агрегатов по filter hash и dataset revision]
    Aggregate --> View[Значение N missing confidence]
    View --> Drill[Конкретные игры и позиции]
```

Базовые count/result/rating/time metrics можно считать без Stockfish. Аналитика качества требует проверенных move results, motifs/features — отдельного слоя с provenance. Общие агрегаты по дню/profile/format/color целесообразно пересчитывать инкрементально; произвольные редкие фильтры — по индексированной выборке. Кэш инвалидировать по изменению dataset/run/formula, а не бесконечно по наличию файла. Рекомендации обязаны ссылаться на cohort/N и конкретные примеры, тренировки — на проверенную линию решения и оригинальную партию. Пользовательский skill profile не строить из текущих недостоверных loss.
