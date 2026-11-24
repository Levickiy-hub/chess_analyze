# Сторонние компоненты

- **chess.js 1.4.0** — BSD-2-Clause, [исходный проект](https://github.com/jhlywa/chess.js). Локальный manifest/license находятся в `node_modules/chess.js/`.
- **@se-oss/stockfish 1.0.1** — [исходный wrapper](https://github.com/shahradelahi/node-stockfish). В установленной поставке manifest заявляет GPL-3.0, а LICENSE содержит MIT; эти метаданные не следует смешивать с лицензией движка.
- **Stockfish.js 17.1**, bundled `stockfish-17.1-8e4d048.cjs/.wasm` — GPLv3 согласно заголовку файла, [Stockfish.js](https://github.com/nmrugg/stockfish.js), [Stockfish](https://github.com/official-stockfish/Stockfish). При подготовке распространяемой сборки включаются соответствующие notices и исходники/предоставление соответствующего исходного кода согласно GPL. Пользовательская рабочая копия использует уже установленный пакет.
- **Node.js** — встроенные HTTP/HTTPS/SQLite APIs; отдельного SQL драйвера приложение не устанавливает.

Интерфейс использует системные шрифты и стандартные Unicode шахматные символы, без копирования графики Chess.com. Публичные данные получаются через [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api); это независимое локальное приложение, не официальный продукт Chess.com.
