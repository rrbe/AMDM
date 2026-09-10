# Mongosh Compatibility Matrix

This matrix records behavior verified against a real single-node MongoDB replica set. The authoritative executable cases live in `test/integration/mongoshCore.test.ts`; this document describes product-visible compatibility rather than duplicating every assertion.

## Verified in both runtimes

| Area        | Examples                                                         | AMDM result behavior                                                               |
| ----------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Reads       | `find`, `findOne`, projection, sort, skip, limit                 | Bare cursors are bounded; Find cursors remain pageable                             |
| Aggregation | `aggregate`, explicit `toArray`                                  | Bare aggregation cursors are bounded and non-pageable; explicit arrays remain full |
| Writes      | insert, update, replace, delete, `bulkWrite`, `findOneAndUpdate` | Write results use the existing acknowledgement/value contract                      |
| Metadata    | collection names/info, database stats, indexes                   | Existing Tree, Table, and JSON rendering receives canonical EJSON                  |
| Commands    | `runCommand`, `adminCommand`, `rs.status`                        | Server errors retain their error name and message                                  |
| BSON        | `ObjectId`, `ISODate`, `NumberLong`, `NumberDecimal`, `BinData`  | Values cross IPC as canonical EJSON                                                |
| JavaScript  | multi-statement scripts, top-level await, async cursor callbacks | Completion values and operation ordering are preserved                             |
| Output      | `print`, `printjson`, `console.*`, output before errors          | Output stays ordered and is capped at 1,000 lines                                  |
| Lifecycle   | `maxTimeMS`, AbortSignal, concurrent shared-client queries       | Cancellation stays scoped to one execution                                         |

The compatibility suite also executes an AI-style four-collection cleanup transaction using `db.getMongo().startSession()`, `session.getDatabase()`, conditional result-count checks, and `withTransaction()`.

## Intentional differences

| Construct                       | Legacy                     | Mongosh                         | Classification                                       |
| ------------------------------- | -------------------------- | ------------------------------- | ---------------------------------------------------- |
| `db.getMongo()` and Session API | Unsupported                | Official behavior               | Mongosh-only                                         |
| `db.collection(name)`           | Driver-style alias         | Unsupported                     | Legacy-only extension; use `db.getCollection(name)`  |
| `cursor.project(spec)`          | Driver-style alias         | Unsupported                     | Legacy-only extension; use `cursor.projection(spec)` |
| `collection.indexes()`          | Driver-style alias         | Unsupported                     | Legacy-only extension; use `collection.getIndexes()` |
| `db.listCollections()`          | Driver cursor escape hatch | Unsupported                     | Legacy-only extension; use `db.getCollectionInfos()` |
| `show collections`              | String rows                | Official `{ name, badge }` rows | Normalized-output difference                         |

The runtime router never retries a failed script in the other engine. These differences therefore surface as explicit errors instead of risking a duplicate write.

## Environment-dependent coverage

- `rs.status()` is verified against a replica set.
- The `sh` helper is verified to exist and return the server-appropriate error on a non-sharded deployment. Successful sharding operations still require a real sharded integration environment.
- Kerberos, Client-Side Field Level Encryption, AWS credentials, and GCP metadata remain outside the current packaged connection-mode guarantee.
