import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { CompassServiceProvider } from "@mongosh/service-provider-node-driver";
import {
  createMongoshServiceProvider,
  evaluateMongosh,
  runMongoshOnClient,
} from "../../src/main/mongo/mongoshCore";

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

describe("official mongosh runtime spike", () => {
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
    expect(cursor.data?.[0]).toMatchObject({ _id: { $oid: expect.any(String) } });

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
    expect(array).toMatchObject({ kind: "documents", count: 3, truncated: false });

    const aggregation = await runMongoshOnClient(client, "db.items.aggregate([{ $sort: { n: 1 } }])", {
      database: "mongosh_spike",
      limit: 2,
    });
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

    const explain = await runMongoshOnClient(client, "db.items.find({ n: 1 })", {
      database: "mongosh_spike",
      explain: true,
    });
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

    const concurrent = await runMongoshOnClient(client, "db.items.countDocuments()", {
      database: "mongosh_spike",
    });
    controller.abort();

    expect(concurrent).toMatchObject({ kind: "value", data: { $numberInt: "3" } });
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
    expect(await client.db("mongosh_spike").collection("items").findOne({ n: 1 })).toMatchObject({
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
});
