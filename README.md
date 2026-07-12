# pi-auto-memory

Simple, Claude Code-inspired persistent memory for the [Pi coding agent](https://pi.dev), stored entirely in Markdown.

The extension adds memory guidance and a startup snapshot to Pi's system prompt. The agent reads and edits memory using its ordinary file tools—there are no custom memory tools, databases, embeddings, background agents, or additional model calls.

## Memory layout

```text
~/.pi/agent/memory/
├── MEMORY.md                         # global index
├── user-preferences.md               # optional global topic
└── projects/
    └── --home-alexe-projects-demo--/
        ├── MEMORY.md                 # launch-directory index
        └── project-decisions.md      # optional project topic
```

Global memory applies in every working directory. Project memory is keyed by the absolute directory from which Pi was launched, using the same path encoding as Pi's default session directories.

Each `MEMORY.md` is loaded up to 200 lines or 25KB. It should remain a concise index; details belong in focused topic files that the agent reads on demand.

## Behavior

The injected policy asks the agent to:

- remember explicit requests immediately;
- proactively retain durable preferences, corrections, and non-obvious decisions;
- avoid transient progress, repository-derivable facts, duplicates, and existing project instructions;
- never store credentials;
- treat memories as fallible notes rather than authoritative instructions.

Memory is snapshotted at session start. Edits remain visible in tool history, while the updated index enters the system prompt on the next session, session switch, or `/reload`. Keeping the snapshot fixed during a session avoids repeatedly changing the prompt and invalidating its input cache.

## Install

Install directly from Git:

```bash
pi install git:github.com/alexei-ciobanu/pi-auto-memory
```

For an isolated test without other extensions:

```bash
pi --no-extensions -e git:github.com/alexei-ciobanu/pi-auto-memory
```

This repository is intentionally not published as an npm package.

## Development

```bash
bun install
bun run check
```

## License

MIT
