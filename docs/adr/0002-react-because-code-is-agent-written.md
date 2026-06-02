# Frontend is React + TypeScript, chosen for agent-writability not human preference

**Status:** accepted

The user will not read or write any code on this project — every line is authored by AI agents. This inverts the usual frontend-selection criteria: the constraint is not the human's familiarity but the **agent's reliability and the availability of ready-made components**.

On that basis React + TypeScript + Vite is the clear pick: the largest training corpus (lowest rate of agent-emitted wrong/outdated patterns), and the richest ecosystem of the exact heavy components this app needs — virtualized tables/trees (`@tanstack/virtual`, `react-window`, AG Grid, react-arborist).

## Considered options

- **Svelte 5** — leaner runtime and philosophically aligned with "anti-bloat," but runes are new; agents frequently emit outdated Svelte 4 patterns. Higher agent-error risk.
- **SolidJS** — best raw large-data update perf, React-like, but small training corpus and ecosystem → more custom components for agents to get wrong.

## Consequences

Framework choice is **not** our performance lever — virtualization discipline is (see [0004-performance-first-architecture.md](./0004-performance-first-architecture.md)). React's heavier runtime is acceptable because correctly-virtualized React is smooth at 10k+ rows.
