# Фактически проведённые проверки

Дата 24.11.2026, Windows/PowerShell, D:/stockfish. Исходный запрос сохранён в REQUEST_REFERENCE.md. Проверки не меняют config/source/raw/results; пишут только новый docs/audit. Зависимости не устанавливались, миграции не выполнялись, main и массовый анализ не запускались.

## Команды и результаты

| Проверка / выполненная команда | Фактический результат | Что этим не подтверждено |
|---|---|---|
| Get-ChildItem -Force, rg --files с исключением node_modules/generated assets | 8 собственных JS, 2 manifest/lock; games/analysis; нет DB/backend/frontend framework/Docker/CI/test файлов | Не содержимое других машин/веток |
| Поиск AGENTS.md через rg и проверка D:/AGENTS.md и корня | Применимых файлов не найдено | Внешние организационные инструкции |
| git status --short | Exit1, not a git repository | История, ветки, diff и чистота Git недоступны |
| Get-Content всех 8 JS, package/lock; rg TODO/FIXME/mock/demo/process.env | Собственный код прочитан полностью; TODO/FIXME/env reads отсутствуют; demo fallback найден чтением reporter | Не качество по названию файла, а фактический код |
| node --version; npm --version | v24.19.0 / 11.17.0 | Поддерживаемый minimum Node не задан |
| npm test | **Exit1**, «Error: no test specified» | Существующих тестов нет; это не падение бизнес-тестов |
| node --check для каждого из 8 JS (через spawnSync в verify.mjs) | 8/8 exit0 | Не подтверждает end-to-end main |
| node docs/audit/verify.mjs, последний запуск exit0 | Сводный JSON verification-results.json | Exit0 означает завершение диагностики, не отсутствие дефектов |
| python docs/audit/build_audit.py; python docs/audit/build_planning.py | Сгенерированы матрица/методика/реестр/backlog только в docs/audit | Это инструменты документации, не новые функции приложения |
| python docs/audit/check_documents.py | Exit0; 14/14 обязательных документов, 720 уникальных требований, 530 продуктовых checkpoint, 29 пакетов/639 дочерних задач; errors=[] в document-validation.json | Проверяет ссылки, поля, покрытия ID, таблицы и числа; не заменяет содержательную экспертизу методики |

При npm test Node сообщил предупреждение о NODE_TLS_REJECT_UNAUTHORIZED, отключающем проверку сертификатов. Проект эту переменную не устанавливает, источник среды не исследовался. Другие значения env и секреты не читались/не публиковались; глобальная среда не менялась.

## Детали диагностики

| Сценарий | Результат / характер проверки |
|---|---|
| Сохранённый raw и analysis | 390 объектов в каждом, 30 607 полуходов; duplicate UUID=0 в этом наборе |
| PGN parsing всего локального набора | 390/390 loadPgn успешно, длины history совпадают с analysis.length; engine не использовался |
| Шахматные правила chess.js | Короткие fixtures: рокировка O-O, en passant exd6, promotion a8=Q+, Fool's mate Qh4#; все разобраны, mate=true в последнем |
| Пересчёт сводки | generateSummary(saved) совпадает с сохранённым summary по JSON.stringify; это проверка воспроизводимости неверных формул |
| Дополнительный node --input-type=module -e с полным обходом verbose history | Все 30 607 Move.before/SAN/LAN совпали с fen/move/lan, PGN analysis==raw, raw headers отсутствует во всех 390; 6 457 bestmove совпадений имеют loss>0; mate категории 1584 Неизвестно/213 Последний ход; результаты dataset-integrity.json. Только чтение и новый audit JSON, engine не запускался |
| POV loss | Fake engine +100/-100/+100 -> loss200 вместо 0: дефект подтверждён |
| Unknown participant | username отсутствует в White/Black, isWhite=false без ошибки: дефект подтверждён |
| SetUp/FEN | Custom PGN принимается, но анализ начинается из стандартного FEN: дефект подтверждён без engine |
| Result='*' | В summary losses=1: дефект подтверждён |
| pool.close | Fake engine terminateCalls=0: дефект подтверждён без запуска pool16 |
| API success/404/429/503 | global fetch временно подменён, finally восстановлен; ожидаемые URL, arrays и общие ошибки подтверждены; real HTTP не выполнен |
| HTML | Приватные generators дополнительно экспортированы **только в прочитанной in-memory копии** data URL module; source не менялся. NaN, unescaped header и nodate mismatch воспроизведены; HTML payload не исполнялся |
| Реальный Stockfish | Один engine, Threads=1 Hash=16, depth4, три позиции; UCI identity, bestmove/cp/PV/nodes/depth получены, обе выгодные стороны дают positive raw cp; прямой terminate в finally и 20s watchdog |
| Engine timeout/error recovery приложения | Статический анализ; crash реального движка намеренно не вызывался |
| Полный API payload | Изучены ключи raw, clocks в PGN; envelope/HTTP headers не сохранены |
| Source/data неизменность | SHA256 до/после verify: **795 существовавших файлов**, changed=[]; docs и node_modules исключены из набора. Это охватывает исходники/manifest и старые данные, а не Git diff |

Подробные машинные результаты и точные значения score/time — verification-results.json. verify.mjs повторяем, но запускает один реальный engine; это не часть существующего npm test. Генераторы документации читают текст исходного задания из attachment path, который может быть недоступен после переноса; сохранённая копия REQUEST_REFERENCE.md позволяет восстановить вход.

## Недоступные или намеренно не выполнявшиеся проверки

- **main / полный локальный запуск:** config MAX_GAMES=0, POOL_SIZE=16, автоматическая сеть и перезапись существующих analysis. Изоляция main без изменения конфигурации потребовала бы дополнительного harness; вместо этого проверены функции в памяти. Не утверждаем полноценную работоспособность приложения.
- **Frontend/backend build:** build скриптов и отдельных build проектов нет; npm run build не запускался. Для JS CLI выполнена синтаксическая проверка и imports модулей. Отсутствие build не равно поломке frontend compilation: такого frontend нет.
- **Чистая установка зависимостей:** запрещена установка без согласования; изучены lock и installed версии. Новая машина/offline installer не проверены.
- **Живые Chess.com запросы:** не выполнялись; endpoint доступность/response currency/реальный 429 не подтверждены. Официальная API документация просмотрена через web, это отдельная проверка контракта.
- **Работающая БД / migrations / SQL plans:** отсутствуют в проекте, подключений нет.
- **Browser E2E / визуальный layout / accessibility:** не выполнялись; только HTML структура/генерация и граничные сценарии в памяти. Нет утверждения о пройденном клике в браузере.
- **Полная партия на движке, depth12 benchmark, pool16, 1k–100k:** не выполнялись по ограничению ресурсоёмкости. Расчёты ENGINE_AUDIT.md основаны на явно заданных гипотезах.
- **Рабочий scheduler/restart/cancel/retry:** реализация отсутствует, проверены только code paths; отказоустойчивость среды не тестировалась.
- **Security penetration, исполняемый XSS, destructive recovery, production инфраструктура:** не выполнялись. Вывод о XSS — безопасная проверка escaping; не доказанный инцидент.
- **Лицензионное/условия распространения:** локальные notices и официальные источники изучены; юридическая экспертиза и предполагаемый способ распространения не определены.

## Внешние источники и границы выводов

Официальная [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api) подтверждает публичный read-only контракт и HTTP рекомендации. Официальный [Stockfish Copying.txt](https://github.com/official-stockfish/Stockfish/blob/master/Copying.txt) использован для отделения GPL движка от лицензии wrapper. Разбор текущих собственных формул основан на локальном коде и контрпримерах, а не внешних пересказах. Сторонние зависимости не подвергались полному аудиту: проверен только используемый integration boundary.
