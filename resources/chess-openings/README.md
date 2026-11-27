# Local opening reference

Source: https://github.com/lichess-org/chess-openings

The pinned revision and download date are recorded in `source.json`.
The upstream TSV files and their CC0 dedication are preserved unchanged.
This reference catalogs named opening lines, not all opening theory.

`book.json` is derived from every legal move in the five TSV files. Keys contain
the pre-move FEN (piece placement, side to move, castling and en passant fields)
and UCI move. Halfmove and fullmove counters are ignored. This allows
transpositions without confusing identical piece placements with different rights.
When multiple named lines contain an edge, the name whose endpoint is closest
to that move is preferred. It identifies a matching reference line, not a unique
or exhaustive classification of the position.

Rebuild after an intentional source update:

    node scripts/build-opening-book.mjs

The application loads the derived index locally on the first game review request.
No network request or engine search is required. Book membership is returned
separately from the engine analysis and never changes quality or accuracy.

The generated index also includes `catalogue` (line metadata and source PGN)
and `positions` (normalized FEN keys mapped to line IDs and halfmove offsets).
The custom position explorer distinguishes a named endpoint from a position
merely occurring inside a named line; legal outgoing book edges are returned
separately from Stockfish results.
