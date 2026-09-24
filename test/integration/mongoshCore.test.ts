import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { CompassServiceProvider } from "@mongosh/service-provider-node-driver";
import {
  createMongoshServiceProvider,
  evaluateMongosh,
  runMongoshOnClient,
} from "../../src/main/mongo/mongoshCore";
import { MAX_OUTPUT_LINES } from "../../src/main/mongo/shellSupport";

let replicaSet: MongoMemoryReplSet;
let client: MongoClient;
let provider: CompassServiceProvider;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(replicaSet.getUri());
  await client.connect();
  provider = createMongoshServiceProvider(client);
}, 120_000);

afterAll(async () => {
  await client?.close().catch(() => {});
  await replicaSet?.stop();
});

beforeEach(async () => {
  const db = client.db("mongosh_spike");
  await db.dropDatabase();
  await db.collection("items").insertMany([{ n: 1 }, { n: 2 }, { n: 3 }]);
});

describe("official mongosh runtime compatibility", () => {
  it("returns a bounded official cursor result over the existing client", async () => {
    const { result } = await evaluateMongosh(
      provider,
      "mongosh_spike",
      "db.items.find().sort({ n: 1 })",
      { limit: 2 },
    );

    expect(result.type).toBe("Cursor");
    expect(result.source).toEqual({
      namespace: { db: "mongosh_spike", collection: "items" },
    });
    expect(result.printable.documents).toHaveLength(2);
    expect(
      result.printable.documents.map((doc: { n: number }) => doc.n),
    ).toEqual([1, 2]);
    expect(result.printable.cursorHasMore).toBe(true);
    expect(result.rawValue).toBeDefined();
  });

  it("runs the standard mongosh Session API and commits a transaction", async () => {
    const { result } = await evaluateMongosh(
      provider,
      "mongosh_spike",
      `const session = db.getMongo().startSession()
       const sessionDb = session.getDatabase(db.getName())
       try {
         session.withTransaction(() => {
           sessionDb.items.updateOne({ n: 1 }, { $set: { committed: true } })
         })
       } finally {
         session.endSession()
       }
       db.items.findOne({ n: 1 })`,
    );

    expect(result.type).toBe("Document");
    expect(result.printable.committed).toBe(true);
    expect(
      await client
        .db("mongosh_spike")
        .collection("items")
        .countDocuments({ committed: true }),
    ).toBe(1);
  });

  it("reports the official Compass restriction for explicit new connections", async () => {
    const uri = replicaSet.getUri();
    const result = await runMongoshOnClient(
      client,
      `new Mongo(${JSON.stringify(uri)})`,
      { database: "mongosh_spike" },
    );

    expect(result).toMatchObject({
      kind: "error",
      errorName: "MongoshUnimplementedError",
    });
    expect(result.error).toContain("new Mongo connections are not supported for current platform: Compass");
  });

  it("exposes the selected database through the explicit driverDb escape hatch", async () => {
    const result = await runMongoshOnClient(
      client,
      'driverDb.collection("items").find({}, { projection: { _id: 0, n: 1 } }).sort({ n: 1 }).toArray()',
      { database: "mongosh_spike" },
    );

    expect(result).toMatchObject({
      kind: "documents",
      count: 3,
      data: [
        { n: { $numberInt: "1" } },
        { n: { $numberInt: "2" } },
        { n: { $numberInt: "3" } },
      ],
    });
  });

  it("returns a bounded raw Driver cursor", async () => {
    const result = await runMongoshOnClient(client,
      'driverDb.collection("items").find().sort({ n: 1 })',
      { database: "mongosh_spike", limit: 2 });
    expect(result).toMatchObject({ kind: "documents", count: 2, truncated: true, pageable: true });
    const next = await runMongoshOnClient(client,
      'driverDb.collection("items").find().sort({ n: 1 })',
      { database: "mongosh_spike", limit: 2, skip: 2 });
    expect(next).toMatchObject({ kind: "documents", count: 1, truncated: false, skip: 2 });
  });

  it("bounds raw aggregation cursors without enabling paging", async () => {
    const result = await runMongoshOnClient(client,
      'driverDb.collection("items").aggregate([{ $sort: { n: 1 } }])',
      { database: "mongosh_spike", limit: 2 });
    expect(result).toMatchObject({ kind: "documents", count: 2, truncated: true, pageable: false });
  });

  it("supports explicit await for intermediate Driver calls", async () => {
    const result = await runMongoshOnClient(client,
      'const names = await driverDb.listCollections().toArray(); names.map(x => x.name)',
      { database: "mongosh_spike" });
    expect(result.kind).toBe("documents");
    expect(result.data).toContain("items");
  });

  it("keeps driverDb reads inside the configured timeout", async () => {
    const result = await runMongoshOnClient(
      client,
      'driverDb.collection("items").find({ $where: "sleep(10000); return true" }).toArray()',
      { database: "mongosh_spike", timeoutMS: 100 },
    );

    expect(result).toMatchObject({ kind: "error", failureKind: "timeout" });
  }, 15_000);

  it("maps bounded cursors and explicit arrays to the existing result contract", async () => {
    const cursor = await runMongoshOnClient(
      client,
      "db.items.find().sort({ n: 1 })",
      { database: "mongosh_spike", limit: 2 },
    );
    expect(cursor).toMatchObject({
      kind: "documents",
      count: 2,
      truncated: true,
      pageable: true,
      skip: 0,
      collection: "items",
    });
    expect(cursor.data).toMatchObject([
      { n: { $numberInt: "1" } },
      { n: { $numberInt: "2" } },
    ]);
    expect(cursor.data?.[0]).toMatchObject({
      _id: { $oid: expect.any(String) },
    });

    const nextPage = await runMongoshOnClient(
      client,
      "db.items.find().sort({ n: 1 })",
      { database: "mongosh_spike", limit: 2, skip: 2 },
    );
    expect(nextPage).toMatchObject({
      kind: "documents",
      count: 1,
      truncated: false,
      pageable: true,
      skip: 2,
      data: [{ n: { $numberInt: "3" } }],
    });

    const array = await runMongoshOnClient(
      client,
      "db.items.find().sort({ n: 1 }).toArray()",
      { database: "mongosh_spike", limit: 2 },
    );
    expect(array).toMatchObject({
      kind: "documents",
      count: 3,
      truncated: false,
    });

    const aggregation = await runMongoshOnClient(
      client,
      "db.items.aggregate([{ $sort: { n: 1 } }])",
      {
        database: "mongosh_spike",
        limit: 2,
      },
    );
    expect(aggregation).toMatchObject({
      kind: "documents",
      count: 2,
      truncated: true,
      pageable: false,
    });
  });

  it("maps write acknowledgements, output and explain results", async () => {
    const write = await runMongoshOnClient(
      client,
      'print("before write"); console.warn("warning"); db.items.updateOne({ n: 1 }, { $set: { updated: true } })',
      { database: "mongosh_spike" },
    );
    expect(write).toMatchObject({
      kind: "ack",
      collection: "items",
      output: [
        { kind: "text", text: "before write", level: "log" },
        { kind: "text", text: "warning", level: "warn" },
      ],
    });

    const explain = await runMongoshOnClient(
      client,
      "db.items.find({ n: 1 })",
      {
        database: "mongosh_spike",
        explain: true,
      },
    );
    expect(explain.kind).toBe("explain");
    expect(explain.data).toMatchObject({ queryPlanner: expect.any(Object) });
  });

  it("supports top-level await in the official runtime", async () => {
    const result = await runMongoshOnClient(
      client,
      "const item = await db.items.findOne({ n: 2 }); item.n",
      { database: "mongosh_spike" },
    );
    expect(result).toMatchObject({ kind: "value", data: { $numberInt: "2" } });
  });

  it("cancels one slow query without interrupting another query on the shared client", async () => {
    const controller = new AbortController();
    const slow = runMongoshOnClient(
      client,
      'db.items.find({ $where: "sleep(10000); return true" })',
      { database: "mongosh_spike", signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const concurrent = await runMongoshOnClient(
      client,
      "db.items.countDocuments()",
      {
        database: "mongosh_spike",
      },
    );
    controller.abort();

    expect(concurrent).toMatchObject({
      kind: "value",
      data: { $numberInt: "3" },
    });
    expect(await slow).toMatchObject({
      kind: "error",
      errorName: "Aborted",
      failureKind: "cancelled",
    });
  }, 15_000);

  it("applies the configured server-side maxTimeMS", async () => {
    const result = await runMongoshOnClient(
      client,
      'db.items.find({ $where: "sleep(10000); return true" })',
      { database: "mongosh_spike", timeoutMS: 100 },
    );
    expect(result).toMatchObject({ kind: "error", failureKind: "timeout" });
  }, 15_000);

  it("never retries a script after execution has started", async () => {
    const result = await runMongoshOnClient(
      client,
      `db.items.updateOne({ n: 1 }, { $inc: { attempts: 1 } })
       throw new SyntaxError("'await' is only allowed within async functions")`,
      { database: "mongosh_spike" },
    );
    expect(result.kind).toBe("error");
    expect(
      await client.db("mongosh_spike").collection("items").findOne({ n: 1 }),
    ).toMatchObject({
      attempts: 1,
    });
  });

  it("releases provider listeners owned by each execution", async () => {
    const event = "topologyDescriptionChanged";
    const listenersBefore = client.listenerCount(event);
    await runMongoshOnClient(client, "db.items.findOne({ n: 1 })", {
      database: "mongosh_spike",
    });
    expect(client.listenerCount(event)).toBe(listenersBefore);
  });

  it("ends sessions left open by an isolated execution", async () => {
    const startSession = client.startSession.bind(client);
    const endSession = vi.fn();
    const startSpy = vi.spyOn(client, "startSession").mockImplementation((options) => {
      const session = startSession(options);
      const end = session.endSession.bind(session);
      endSession.mockImplementation(end);
      session.endSession = endSession;
      return session;
    });

    try {
      const result = await runMongoshOnClient(client, "db.getMongo().startSession(); 1", {
        database: "mongosh_spike",
      });
      expect(result).toMatchObject({ kind: "value", data: { $numberInt: "1" } });
      expect(endSession).toHaveBeenCalledOnce();
    } finally {
      startSpy.mockRestore();
    }
  });

  it("supports common database helpers and commands", async () => {
    const databaseName = await runMongoshOnClient(client, "db.getName()", {
      database: "mongosh_spike",
    });
    expect(databaseName).toMatchObject({
      kind: "value",
      data: "mongosh_spike",
    });

    const ping = await runMongoshOnClient(
      client,
      "db.runCommand({ ping: 1 })",
      {
        database: "mongosh_spike",
      },
    );
    expect(ping).toMatchObject({
      kind: "value",
      data: { ok: { $numberInt: "1" } },
    });

    const adminPing = await runMongoshOnClient(
      client,
      "db.adminCommand({ ping: 1 })",
      {
        database: "mongosh_spike",
      },
    );
    expect(adminPing).toMatchObject({
      kind: "value",
      data: { ok: { $numberInt: "1" } },
    });

    const collectionNames = await runMongoshOnClient(
      client,
      "db.getCollectionNames()",
      {
        database: "mongosh_spike",
      },
    );
    expect(collectionNames).toMatchObject({
      kind: "documents",
      data: ["items"],
    });

    const siblingName = await runMongoshOnClient(
      client,
      "db.getMongo().getDB('mongosh_sibling').getName()",
      { database: "mongosh_spike" },
    );
    expect(siblingName).toMatchObject({
      kind: "value",
      data: "mongosh_sibling",
    });

    const version = await runMongoshOnClient(client, "db.version()", {
      database: "mongosh_spike",
    });
    expect(version).toMatchObject({ kind: "value", data: expect.any(String) });
  });

  it("supports insert, update, replace and delete write operations", async () => {
    const insertOne = await runMongoshOnClient(
      client,
      "db.items.insertOne({ n: 4 })",
      {
        database: "mongosh_spike",
      },
    );
    expect(insertOne).toMatchObject({
      kind: "ack",
      data: { acknowledged: true },
    });

    const insertMany = await runMongoshOnClient(
      client,
      "db.items.insertMany([{ n: 5 }, { n: 6 }])",
      {
        database: "mongosh_spike",
      },
    );
    expect(insertMany).toMatchObject({
      kind: "ack",
      data: { acknowledged: true },
    });

    const updateMany = await runMongoshOnClient(
      client,
      "db.items.updateMany({}, { $inc: { touched: 1 } })",
      {
        database: "mongosh_spike",
      },
    );
    expect(updateMany).toMatchObject({
      kind: "ack",
      data: { matchedCount: { $numberInt: "6" } },
    });

    const replaceOne = await runMongoshOnClient(
      client,
      "db.items.replaceOne({ n: 6 }, { n: 60 })",
      {
        database: "mongosh_spike",
      },
    );
    expect(replaceOne).toMatchObject({
      kind: "ack",
      data: { modifiedCount: { $numberInt: "1" } },
    });

    const deleteOne = await runMongoshOnClient(
      client,
      "db.items.deleteOne({ n: 60 })",
      {
        database: "mongosh_spike",
      },
    );
    expect(deleteOne).toMatchObject({
      kind: "ack",
      data: { deletedCount: { $numberInt: "1" } },
    });

    const deleteMany = await runMongoshOnClient(
      client,
      "db.items.deleteMany({ n: { $gte: 4 } })",
      {
        database: "mongosh_spike",
      },
    );
    expect(deleteMany).toMatchObject({
      kind: "ack",
      data: { deletedCount: { $numberInt: "2" } },
    });
  });

  it("supports bulkWrite and findOneAndUpdate", async () => {
    const bulk = await runMongoshOnClient(
      client,
      `db.items.bulkWrite([
        { insertOne: { document: { n: 4 } } },
        { updateOne: { filter: { n: 1 }, update: { $set: { bulk: true } } } }
      ])`,
      { database: "mongosh_spike" },
    );
    expect(bulk).toMatchObject({ kind: "ack", data: { acknowledged: true } });

    const updated = await runMongoshOnClient(
      client,
      "db.items.findOneAndUpdate({ n: 2 }, { $set: { changed: true } }, { returnDocument: 'after' })",
      { database: "mongosh_spike" },
    );
    expect(updated).toMatchObject({
      kind: "value",
      data: { n: { $numberInt: "2" }, changed: true },
    });
  });

  it("supports count, distinct and index operations", async () => {
    const count = await runMongoshOnClient(
      client,
      "db.items.countDocuments({ n: { $gte: 2 } })",
      {
        database: "mongosh_spike",
      },
    );
    expect(count).toMatchObject({ kind: "value", data: { $numberInt: "2" } });

    const distinct = await runMongoshOnClient(
      client,
      "db.items.distinct('n')",
      {
        database: "mongosh_spike",
      },
    );
    expect(distinct).toMatchObject({
      kind: "documents",
      data: [{ $numberInt: "1" }, { $numberInt: "2" }, { $numberInt: "3" }],
    });

    const created = await runMongoshOnClient(
      client,
      "db.items.createIndex({ n: 1 }, { name: 'n_1' })",
      {
        database: "mongosh_spike",
      },
    );
    expect(created).toMatchObject({ kind: "value", data: "n_1" });

    const indexes = await runMongoshOnClient(client, "db.items.getIndexes()", {
      database: "mongosh_spike",
    });
    expect(indexes.kind).toBe("documents");
    expect(indexes.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "n_1" })]),
    );

    const dropped = await runMongoshOnClient(
      client,
      "db.items.dropIndex('n_1')",
      {
        database: "mongosh_spike",
      },
    );
    expect(dropped.kind).toBe("value");
  });

  it("round-trips common BSON constructors as canonical EJSON", async () => {
    const result = await runMongoshOnClient(
      client,
      `const id = ObjectId()
       db.bson.insertOne({
         _id: id,
         date: ISODate("2026-01-02T03:04:05.000Z"),
         long: NumberLong("9223372036854775807"),
         decimal: NumberDecimal("123.45"),
         binary: BinData(0, "AQID")
       })
       db.bson.findOne({ _id: id })`,
      { database: "mongosh_spike" },
    );
    expect(result).toMatchObject({
      kind: "value",
      data: {
        _id: { $oid: expect.any(String) },
        date: { $date: { $numberLong: "1767323045000" } },
        long: { $numberLong: "9223372036854775807" },
        decimal: { $numberDecimal: "123.45" },
        binary: { $binary: { base64: "AQID", subType: "00" } },
      },
    });
  });

  it("supports use and show REPL commands", async () => {
    const useDatabase = await runMongoshOnClient(client, "use mongosh_other", {
      database: "mongosh_spike",
    });
    expect(useDatabase).toMatchObject({
      kind: "value",
      useDatabase: "mongosh_other",
    });

    const collections = await runMongoshOnClient(client, "show collections", {
      database: "mongosh_spike",
    });
    expect(collections).toMatchObject({ kind: "documents" });
    expect(collections.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "items" })]),
    );
  });

  it("awaits asynchronous cursor callbacks and multi-statement scripts", async () => {
    const result = await runMongoshOnClient(
      client,
      `db.items.find().forEach((item) => db.copies.insertOne({ n: item.n }))
       db.copies.countDocuments()`,
      { database: "mongosh_spike" },
    );
    expect(result).toMatchObject({ kind: "value", data: { $numberInt: "3" } });
  });

  it("preserves output before errors and bounds large console output", async () => {
    const failed = await runMongoshOnClient(
      client,
      'print("before"); throw new Error("boom")',
      {
        database: "mongosh_spike",
      },
    );
    expect(failed).toMatchObject({
      kind: "error",
      error: "boom",
      output: [{ kind: "text", text: "before", level: "log" }],
    });

    const bounded = await runMongoshOnClient(
      client,
      `for (let i = 0; i < ${MAX_OUTPUT_LINES + 2}; i++) print(i); "done"`,
      { database: "mongosh_spike" },
    );
    expect(bounded).toMatchObject({
      kind: "value",
      data: "done",
      outputTruncated: true,
    });
    expect(bounded.output).toHaveLength(MAX_OUTPUT_LINES);
  });

  it("returns syntax, reference and server errors without losing their names", async () => {
    const syntax = await runMongoshOnClient(client, "const =", {
      database: "mongosh_spike",
    });
    expect(syntax).toMatchObject({ kind: "error", errorName: "SyntaxError" });

    const reference = await runMongoshOnClient(client, "missingIdentifier", {
      database: "mongosh_spike",
    });
    expect(reference).toMatchObject({
      kind: "error",
      errorName: "ReferenceError",
    });

    const server = await runMongoshOnClient(
      client,
      "db.items.find({ $badOperator: 1 })",
      {
        database: "mongosh_spike",
      },
    );
    expect(server.kind).toBe("error");
  });

  it("supports find projections, cursor chaining and aggregation pipelines", async () => {
    const projected = await runMongoshOnClient(
      client,
      "db.items.find({ n: { $gte: 2 } }, { _id: 0, n: 1 }).sort({ n: -1 }).skip(1).limit(1)",
      { database: "mongosh_spike" },
    );
    expect(projected).toMatchObject({
      kind: "documents",
      count: 1,
      data: [{ n: { $numberInt: "2" } }],
    });

    const grouped = await runMongoshOnClient(
      client,
      "db.items.aggregate([{ $group: { _id: null, total: { $sum: '$n' } } }]).toArray()",
      { database: "mongosh_spike" },
    );
    expect(grouped).toMatchObject({
      kind: "documents",
      data: [{ _id: null, total: { $numberInt: "6" } }],
    });
  });

  it("supports collection metadata and database statistics", async () => {
    const infos = await runMongoshOnClient(
      client,
      "db.getCollectionInfos({ name: 'items' })",
      {
        database: "mongosh_spike",
      },
    );
    expect(infos.kind).toBe("documents");
    expect(infos.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "items" })]),
    );

    const listed = await runMongoshOnClient(
      client,
      "db.listCollections().toArray()",
      {
        database: "mongosh_spike",
      },
    );
    expect(listed).toMatchObject({
      kind: "error",
      errorName: "TypeError",
      error: expect.stringContaining("listCollections"),
    });

    const stats = await runMongoshOnClient(client, "db.stats()", {
      database: "mongosh_spike",
    });
    expect(stats).toMatchObject({
      kind: "value",
      data: { db: "mongosh_spike" },
    });
  });

  it.each([
    [
      "db.collection(name)",
      "db.collection('items').findOne({ n: 1 })",
      "collection",
    ],
    ["cursor.project(spec)", "db.items.find().project({ n: 1 })", "project"],
    ["collection.indexes()", "db.items.indexes()", "indexes"],
  ])(
    "classifies AMDM driver-only extension %s without fallback",
    async (_name, code, method) => {
      const result = await runMongoshOnClient(client, code, {
        database: "mongosh_spike",
      });
      expect(result).toMatchObject({
        kind: "error",
        errorName: "TypeError",
        error: expect.stringContaining(method),
      });
    },
  );

  it("exposes replica-set and sharding helpers with server-appropriate behavior", async () => {
    const replicaStatus = await runMongoshOnClient(client, "rs.status()", {
      database: "mongosh_spike",
    });
    expect(replicaStatus).toMatchObject({
      kind: "value",
      data: { set: "testset" },
    });

    const shardingStatus = await runMongoshOnClient(client, "sh.status()", {
      database: "mongosh_spike",
    });
    expect(shardingStatus.kind).toBe("error");
    expect(shardingStatus.errorName).not.toBe("ReferenceError");
  });

  it("captures printjson as canonical EJSON while preserving completion values", async () => {
    const result = await runMongoshOnClient(
      client,
      'printjson({ id: ObjectId("64b64c50f1f2a3b4c5d6e7f8") }); 42',
      { database: "mongosh_spike" },
    );
    expect(result).toMatchObject({
      kind: "value",
      data: { $numberInt: "42" },
      output: [
        {
          kind: "json",
          data: { id: { $oid: "64b64c50f1f2a3b4c5d6e7f8" } },
          level: "log",
        },
      ],
    });
  });

  it("executes an AI-style multi-collection cleanup transaction atomically", async () => {
    const db = client.db("mongosh_spike");
    const user = "64b64c50f1f2a3b4c5d6e7f1";
    const task = "64b64c50f1f2a3b4c5d6e7f2";
    const progress = "64b64c50f1f2a3b4c5d6e7f3";
    const point = "64b64c50f1f2a3b4c5d6e7f4";
    await db.collection("progresses").insertOne({
      _id: new ObjectId(progress),
      user: new ObjectId(user),
      task: new ObjectId(task),
      status: "COMPLETED",
    });
    await db.collection("logs").insertOne({
      user: new ObjectId(user),
      progress: new ObjectId(progress),
    });
    await db.collection("points").insertOne({
      _id: new ObjectId(point),
      user: new ObjectId(user),
      point: 10,
    });
    await db.collection("tasks").insertOne({
      _id: new ObjectId(task),
      totalRewardPoints: 100,
      totalFinishUsers: 2,
    });

    const result = await runMongoshOnClient(
      client,
      `const session = db.getMongo().startSession()
       const sessionDb = session.getDatabase(db.getName())
       try {
         session.withTransaction(() => {
           const progressResult = sessionDb.progresses.deleteOne({ _id: ObjectId("${progress}") })
           const logResult = sessionDb.logs.deleteOne({ progress: ObjectId("${progress}") })
           const pointResult = sessionDb.points.updateOne(
             { _id: ObjectId("${point}"), point: 10 },
             { $set: { point: 5, updatedAt: new Date() } }
           )
           const taskResult = sessionDb.tasks.updateOne(
             { _id: ObjectId("${task}"), totalRewardPoints: 100, totalFinishUsers: 2 },
             { $set: { totalRewardPoints: 95, totalFinishUsers: 1, updatedAt: new Date() } }
           )
           if (
             progressResult.deletedCount !== 1 ||
             logResult.deletedCount !== 1 ||
             pointResult.modifiedCount !== 1 ||
             taskResult.modifiedCount !== 1
           ) throw new Error("transaction mismatch")
         })
       } finally {
         session.endSession()
       }
       db.points.findOne({ _id: ObjectId("${point}") })`,
      { database: "mongosh_spike" },
    );

    expect(result).toMatchObject({
      kind: "value",
      data: { point: { $numberInt: "5" } },
    });
    expect(await db.collection("progresses").countDocuments()).toBe(0);
    expect(await db.collection("logs").countDocuments()).toBe(0);
    expect(await db.collection("tasks").findOne()).toMatchObject({
      totalRewardPoints: 95,
      totalFinishUsers: 1,
    });
  });
});
