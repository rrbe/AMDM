import vm from "node:vm";
import { EventEmitter } from "node:events";
import type { MongoClient } from "mongodb";
import { ShellEvaluator } from "@mongosh/shell-evaluator";
import {
  ShellInstanceState,
  toShellResult,
  type ShellResult as MongoshResult,
} from "@mongosh/shell-api";
import {
  CompassServiceProvider,
  type DevtoolsConnectOptions,
} from "@mongosh/service-provider-node-driver";

const EXEC_TIMEOUT_MS = 30_000;

/**
 * Stage-0 adapter over AMDM's existing connected client. Keeping construction
 * separate from evaluation lets the production backend own one provider per
 * connection instead of adding driver listeners for every query.
 */
export function createMongoshServiceProvider(
  client: MongoClient,
): CompassServiceProvider {
  return new CompassServiceProvider(
    client,
    new EventEmitter(),
    client.options as unknown as DevtoolsConnectOptions,
  );
}

export interface MongoshEvaluationOptions {
  limit?: number;
}

/**
 * Evaluate one stateless script with the official mongosh evaluator and Shell
 * API while retaining the raw ShellResult for AMDM's later result adapter.
 * This is intentionally not wired to IPC until packaging and parity gates pass.
 */
export async function evaluateMongosh(
  provider: CompassServiceProvider,
  database: string,
  code: string,
  options: MongoshEvaluationOptions = {},
): Promise<MongoshResult> {
  const state = new ShellInstanceState(provider);
  state.setPreFetchCollectionAndDatabaseNames(false);
  state.displayBatchSizeFromDBQuery = options.limit ?? 50;
  state.currentDb = state.currentDb.getMongo().getDB(database);

  const context = vm.createContext({});
  const contextObject = vm.runInContext("globalThis", context) as Record<
    string,
    unknown
  >;
  state.setCtx(contextObject);

  const evaluator = new ShellEvaluator(state, (value) => toShellResult(value));
  const evaluate = async (
    input: string,
    _context: object,
    filename: string,
  ): Promise<unknown> => {
    const script = new vm.Script(input, { filename: filename || "shell.js" });
    return script.runInContext(context, { timeout: EXEC_TIMEOUT_MS });
  };

  return evaluator.customEval(evaluate, code, contextObject, "shell.js");
}
