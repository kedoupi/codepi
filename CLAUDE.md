# kedoupi project entry

@AGENTS.md

Read the target directory's `AGENTS.md` before editing. Project rules live in
that shared hierarchy, not in a separate Claude-specific copy.
Use the matching skill in `.claude/skills/`; each entry loads the canonical
workflow from `.agents/skills/`.
Tool entry points: `docs/development/agent-compatibility.md`.
Rule ownership and task routing: `docs/development/README.md`.
Skills cover development, review, integration/release and handoff; loading a
skill does not authorize Git or remote mutations.
