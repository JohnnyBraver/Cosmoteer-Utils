# Comparison snapshots

Each dated folder contains a frozen comparison recipe for a specific source dataset, game-data version, and set of analysis decisions. A recipe may encode candidate selection, role mappings, corrections, expected counts, and validation rules directly in code.

Treat an existing snapshot as historical evidence. For materially different inputs or decisions, create a new dated folder and document the source audit, UI map, assumptions, and changes. Reuse across unrelated datasets requires reviewing the code and adapting or extracting its assumptions; the folder name alone does not make a recipe general-purpose.
