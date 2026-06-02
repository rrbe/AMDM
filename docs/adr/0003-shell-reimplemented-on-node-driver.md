# The Shell is reimplemented on the official Node driver, not embedded mongosh

**Status:** accepted

The user types JavaScript (`db.lives.find({...})`) and we must render results as Tree/JSON/Table. That requires **typed BSON objects** in hand, not piped text. We evaluate the user's input in a Node `vm` sandbox where `db` is a shim that translates `db.coll.find()/aggregate()/...` into official **MongoDB Node.js driver** calls, returning live BSON. We implement the focused subset of the shell API the user actually needs, not the whole surface.

## Considered options

- **Embed `mongosh`** (what NoSQLBooster v8 did) — full shell compatibility for free, but heavier, harder to extract structured results for rendering, and its client-side execution model makes loops/`forEach` slow (download→process→re-upload). Research flagged this as a regression.
- **Spawn `mongosh` and capture stdout** — simplest, but text output can't drive Tree/Table views and loses typed BSON. Rejected.

## Consequences

We own the shell surface: gaps appear as "unsupported helper" rather than silent wrong behavior, and we add helpers incrementally. Bulk/loop operations should be steered toward server-side aggregation/`bulkWrite` to avoid the client-side penalty. This is the architectural reason Electron/Node was chosen — see [0001-build-on-electron.md](./0001-build-on-electron.md).
