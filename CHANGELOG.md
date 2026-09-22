# Changelog

## 0.2.0 - 2026-09-22

- Add optional ordered workflow stages, arrow navigation and nested work details.
- Show current position, unfinished prerequisites, detour return point and next action together.
- Group historical document sections by heading, render only the selected section, and collapse event groups by date.
- Keep raw-source access; omit inactive folder buttons when the project path is unknown.
- Preserve optional workflow metadata when creating a card; retain compatibility with existing schemaVersion 1 cards.
- Add synthetic tests for navigation, section boundaries, escaping, stale responses, source integrity and metadata persistence.
- No new dependencies, private task records, automatic startup, lifecycle hooks or native fixed button.

Validation boundary: automated tests do not replace real-browser viewport, keyboard and visual acceptance, which remains pending.
