import type {
  JsonValue,
  MongoJsonSchema,
  SchemaTarget,
  SchemaAnalysis,
  SchemaModel,
} from "./types";

export function schemaTargetKey(target: SchemaTarget): string {
  if (!target?.connectionId || !target.database || !target.collection) {
    throw new Error("Invalid schema target.");
  }
  return JSON.stringify([
    target.connectionId,
    target.database,
    target.collection,
  ]);
}

function cloneJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${path} must contain finite numbers.`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      cloneJsonValue(item, `${path}[${index}]`),
    );
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = cloneJsonValue(item, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path} must be valid JSON.`);
}

/** Validate the IPC trust boundary and return a detached JSON-only object. */
export function cloneMongoJsonSchema(value: unknown): MongoJsonSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Schema must be a JSON object.");
  }
  return cloneJsonValue(value, "Schema") as MongoJsonSchema;
}

export function modelWithAnalysis(
  target: SchemaTarget,
  analysis: SchemaAnalysis,
  previous?: SchemaModel,
): SchemaModel {
  return {
    target,
    analysis,
    draft: previous?.draft ?? cloneMongoJsonSchema(analysis.generated),
    draftUpdatedAt: previous?.draftUpdatedAt ?? analysis.analyzedAt,
  };
}

export function modelWithDraft(
  previous: SchemaModel | undefined,
  draft?: MongoJsonSchema,
): SchemaModel {
  if (!previous)
    throw new Error("Analyze the collection before editing a Schema.");
  return {
    ...previous,
    draft: cloneMongoJsonSchema(draft ?? previous.analysis.generated),
    draftUpdatedAt: Date.now(),
  };
}
