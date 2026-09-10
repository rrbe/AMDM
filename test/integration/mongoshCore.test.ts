import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { CompassServiceProvider } from "@mongosh/service-provider-node-driver";
import {
  createMongoshServiceProvider,
  evaluateMongosh,
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
    const result = await evaluateMongosh(
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
    const result = await evaluateMongosh(
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
});
