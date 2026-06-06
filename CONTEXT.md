# AMDM (Another Mongo Desktop Manager)

A lean, performance-first desktop GUI for MongoDB — a personal replacement for NoSQLBooster that keeps its best UX (the three result views) and drops the bloat that made it laggy.

## Language

**Connection**:
A saved, reusable definition of how to reach one MongoDB deployment (URI/hosts, auth, TLS, replica set, options). Carries its own optional **color** tag.
_Avoid_: Server, database connection, profile

**Color**:
An optional preset color tag chosen per Connection, shown as a bar/dot in the sidebar. There is no separate grouping entity — color is the only organizing dimension.
_Avoid_: Group, label, category

**Deployment**:
The actual MongoDB target a Connection points at — standalone, replica set, or sharded cluster.
_Avoid_: Cluster (only when sharded), instance

**Shell**:
The editor + execution context where the user types JavaScript (e.g. `db.lives.find()`) against a Connection and gets typed results back.
_Avoid_: Console, terminal, REPL

**Result View**:
One of three interchangeable renderings of a query result: **Tree**, **JSON**, or **Table**.
_Avoid_: Output, grid (Table only)

**Saved Query**:
A named, stored Shell snippet the user can re-apply later, scoped to a Connection or global.
_Avoid_: Bookmark, favorite, snippet

**Explain**:
The rendered analysis of a query's execution plan (`explain()` output), used for performance diagnosis.
_Avoid_: Analysis, plan (alone)

## Relationships

- A **Connection** has zero or one **Color** tag
- A **Connection** targets exactly one **Deployment**
- A **Connection** opens one or more **Shell** sessions
- A **Shell** execution produces a result rendered through one **Result View** at a time (Tree / JSON / Table)
- A **Saved Query** belongs to a **Connection** (or is global) and is loaded into a **Shell**

## Example dialogue

> **User:** "I want to color my **Connections** by environment."
> **Dev:** "Color is per-**Connection** — pick a preset swatch on each one (e.g. red for prod). There's no group entity; the color tag *is* the grouping signal in the sidebar."

## Flagged ambiguities

- **Connection Group** (removed): originally color lived on a separate grouping folder. Resolved — there is no Group entity; **Color** is a per-Connection tag and the only organizing dimension.
