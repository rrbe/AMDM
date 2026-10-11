# Mongosh Compatibility Matrix

This matrix records behavior verified against a real single-node MongoDB replica set. The authoritative executable cases live in `test/integration/mongoshCore.test.ts`; this document describes product-visible compatibility rather than duplicating every assertion.

## Verified Mongosh behavior

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

## Moving older scripts to Mongosh

Saved query and history text is preserved; all executions use Mongosh. Update Driver-style expressions explicitly:

| Older expression | Mongosh expression |
| --- | --- |
| `db.collection(name)` | `db.getCollection(name)` |
| `cursor.project(spec)` | `cursor.projection(spec)` |
| `collection.indexes()` | `collection.getIndexes()` |
| `db.listCollections().toArray()` | `db.getCollectionInfos()` |

For native Node Driver signatures use `driverDb.collection(name)` or `driverDb.listCollections()`, with explicit `await` for intermediate promises. Find options belong in the Driver's second argument, for example `await driverDb.collection("items").find({}, { projection: { _id: 0 } }).toArray()`.

Mongosh supports `db.getMongo()` and the Session API. `new Mongo(uri)` is unavailable through the Compass provider; use AMDM connection management. REPL commands use official case-sensitive syntax. `show collections` returns official name/badge objects; `insertMany` returns acknowledgement and inserted IDs.

The regression suites in `test/integration/shellBehavior.test.ts` and `test/integration/mongoshCore.test.ts` cover Shell behavior, Driver cursor bounds/paging, serialization cancellation, and transactions.

## Environment-dependent coverage

- `rs.status()` is verified against a replica set.
- The `sh` helper is verified to exist and return the server-appropriate error on a non-sharded deployment. Successful sharding operations still require a real sharded integration environment.
- Kerberos, Client-Side Field Level Encryption, AWS credentials, and GCP metadata remain outside the current packaged connection-mode guarantee.
