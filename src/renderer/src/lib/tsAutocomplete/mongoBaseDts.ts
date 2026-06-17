/**
 * Hand-written base TypeScript declarations for the mongo shell, fed to the
 * in-worker TS language service to power type-aware chained completion
 * (`db.coll.find().sort().limit().`). Deliberately models the SAME subset our
 * `shellCore` sandbox actually implements — so completion never suggests driver
 * methods the shell can't run (the project's "fail loudly, no silent subset"
 * stance). Live collection names are layered on at runtime via
 * `buildCollectionDecls` (interface merging onto `Database`).
 *
 * Runs with `noLib`, so the minimal globals every shell script needs are baked
 * in here too (avoids bundling ~30 `lib.es*.d.ts` files into the worker).
 *
 * IMPORTANT: this must stay a global *script* (no `import`/`export` inside the
 * string) so `declare const db` is global and `interface Database` merges with
 * the generated declarations.
 */

export const MONGO_BASE_DTS = `
// ---- minimal globals (noLib) ----
interface Object { toString(): string; hasOwnProperty(p: string): boolean; }
interface ObjectConstructor { keys(o: any): string[]; values(o: any): any[]; assign(t: any, ...s: any[]): any; entries(o: any): [string, any][]; }
declare var Object: ObjectConstructor;
interface Function { apply(thisArg: any, args?: any[]): any; call(thisArg: any, ...args: any[]): any; bind(thisArg: any, ...args: any[]): any; }
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { length: number; [i: number]: any; }
interface Boolean {}
interface Number { toFixed(digits?: number): string; toString(radix?: number): string; valueOf(): number; }
interface String {
  length: number;
  charAt(i: number): string; indexOf(s: string, from?: number): number; lastIndexOf(s: string): number;
  slice(start?: number, end?: number): string; substring(start: number, end?: number): string; substr(from: number, len?: number): string;
  toLowerCase(): string; toUpperCase(): string; trim(): string; split(sep: string | RegExp, limit?: number): string[];
  replace(pat: string | RegExp, repl: string): string; padStart(n: number, p?: string): string; padEnd(n: number, p?: string): string;
  startsWith(s: string): boolean; endsWith(s: string): boolean; includes(s: string): boolean; repeat(n: number): string; [i: number]: string;
}
interface TemplateStringsArray extends ReadonlyArray<string> {}
interface Array<T> {
  length: number; [n: number]: T;
  push(...items: T[]): number; pop(): T | undefined; shift(): T | undefined; unshift(...items: T[]): number;
  map<U>(fn: (value: T, index: number) => U): U[]; filter(fn: (value: T, index: number) => unknown): T[];
  forEach(fn: (value: T, index: number) => void): void; find(fn: (value: T, index: number) => unknown): T | undefined;
  findIndex(fn: (value: T) => unknown): number; indexOf(value: T): number; includes(value: T): boolean;
  slice(start?: number, end?: number): T[]; splice(start: number, deleteCount?: number, ...items: T[]): T[];
  concat(...items: T[][]): T[]; join(sep?: string): string; reverse(): T[]; sort(fn?: (a: T, b: T) => number): T[];
  reduce<U>(fn: (acc: U, value: T, index: number) => U, init: U): U; some(fn: (value: T) => unknown): boolean; every(fn: (value: T) => unknown): boolean;
}
interface ReadonlyArray<T> { readonly length: number; readonly [n: number]: T; map<U>(fn: (value: T, index: number) => U): U[]; forEach(fn: (value: T) => void): void; }
interface ArrayConstructor { isArray(arg: any): boolean; from(arrayLike: any): any[]; (): any[]; new (): any[]; }
declare var Array: ArrayConstructor;
interface RegExp { test(s: string): boolean; exec(s: string): string[] | null; source: string; flags: string; }
interface RegExpConstructor { (pattern: string, flags?: string): RegExp; new (pattern: string, flags?: string): RegExp; }
declare var RegExp: RegExpConstructor;
interface Symbol { toString(): string; }
interface Error { name: string; message: string; stack?: string; }
interface ErrorConstructor { (message?: string): Error; new (message?: string): Error; }
declare var Error: ErrorConstructor;
interface Date { getTime(): number; toISOString(): string; getFullYear(): number; getMonth(): number; getDate(): number; getHours(): number; valueOf(): number; }
interface DateConstructor { (): string; new (value?: number | string): Date; now(): number; }
declare var Date: DateConstructor;
interface Promise<T> { then<U>(onfulfilled?: (value: T) => U): Promise<U>; catch(onrejected?: (reason: any) => any): Promise<T>; }
interface PromiseConstructor { resolve<T>(value: T): Promise<T>; reject(reason?: any): Promise<never>; all(values: any[]): Promise<any[]>; }
declare var Promise: PromiseConstructor;
declare var Math: { floor(n: number): number; ceil(n: number): number; round(n: number): number; trunc(n: number): number; abs(n: number): number; max(...n: number[]): number; min(...n: number[]): number; pow(b: number, e: number): number; sqrt(n: number): number; random(): number; PI: number; };
declare var JSON: { stringify(value: any, replacer?: any, space?: any): string; parse(text: string): any; };
declare var console: { log(...args: any[]): void; info(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void; };
declare function parseInt(s: string, radix?: number): number;
declare function parseFloat(s: string): number;
declare function isNaN(n: number): boolean;
type Record<K extends string | number | symbol, T> = { [P in K]: T };
type Partial<T> = { [P in keyof T]?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Array_<T> = Array<T>;

// ---- mongo shell API (subset mirrors shellCore shims) ----
type Document = { [key: string]: any };

interface Cursor {
  sort(spec: Document | string): Cursor;
  limit(value: number): Cursor;
  skip(value: number): Cursor;
  project(spec: Document): Cursor;
  projection(spec: Document): Cursor;
  hint(index: Document | string): Cursor;
  collation(spec: Document): Cursor;
  comment(text: string): Cursor;
  batchSize(size: number): Cursor;
  maxTimeMS(ms: number): Cursor;
  min(spec: Document): Cursor;
  max(spec: Document): Cursor;
  returnKey(value: boolean): Cursor;
  showRecordId(value: boolean): Cursor;
  tailable(): Cursor;
  allowDiskUse(): Cursor;
  addCursorFlag(flag: string, value: boolean): Cursor;
  pretty(): Cursor;
  toArray(): Document[];
  forEach(fn: (doc: Document) => void): void;
  map<U>(fn: (doc: Document) => U): U[];
  hasNext(): boolean;
  next(): Document;
  count(): number;
  size(): number;
  itcount(): number;
  explain(verbosity?: string): Document;
}

interface AggregationCursor {
  pretty(): AggregationCursor;
  toArray(): Document[];
  forEach(fn: (doc: Document) => void): void;
  map<U>(fn: (doc: Document) => U): U[];
  hasNext(): boolean;
  next(): Document;
  itcount(): number;
  explain(verbosity?: string): Document;
}

interface Collection {
  find(query?: Document, projection?: Document): Cursor;
  findOne(query?: Document, projection?: Document): Document;
  aggregate(pipeline?: Document[], options?: Document): AggregationCursor;
  countDocuments(query?: Document, options?: Document): number;
  estimatedDocumentCount(options?: Document): number;
  count(query?: Document, options?: Document): number;
  distinct(field: string, query?: Document): any[];
  insertOne(doc: Document, options?: Document): Document;
  insertMany(docs: Document[], options?: Document): Document;
  updateOne(filter: Document, update: Document, options?: Document): Document;
  updateMany(filter: Document, update: Document, options?: Document): Document;
  replaceOne(filter: Document, replacement: Document, options?: Document): Document;
  deleteOne(filter: Document, options?: Document): Document;
  deleteMany(filter: Document, options?: Document): Document;
  findOneAndUpdate(filter: Document, update: Document, options?: Document): Document;
  findOneAndReplace(filter: Document, replacement: Document, options?: Document): Document;
  findOneAndDelete(filter: Document, options?: Document): Document;
  bulkWrite(operations: Document[], options?: Document): Document;
  createIndex(keys: Document, options?: Document): string;
  createIndexes(specs: Document[]): Document;
  dropIndex(index: string | Document): Document;
  dropIndexes(): Document;
  indexes(): Document[];
  getIndexes(): Document[];
  listIndexes(): Cursor;
  drop(): boolean;
  rename(name: string, dropTarget?: boolean): Document;
  watch(pipeline?: Document[], options?: Document): any;
  mapReduce(map: Function, reduce: Function, options: Document): Document;
}

interface Database {
  getCollection(name: string): Collection;
  getSiblingDB(name: string): Database;
  getCollectionNames(): string[];
  getCollectionInfos(filter?: Document): Document[];
  getName(): string;
  version(): string;
  runCommand(command: Document): Document;
  adminCommand(command: Document): Document;
  aggregate(pipeline?: Document[], options?: Document): AggregationCursor;
  stats(): Document;
  listCollections(filter?: Document): Cursor;
  dropDatabase(): Document;
  createCollection(name: string, options?: Document): Document;
  command(command: Document): Document;
  admin(): Database;
  watch(pipeline?: Document[], options?: Document): any;
}

declare const db: Database;

// ---- EJSON constructors (shellCore sandbox) ----
declare function ObjectId(id?: string): any;
declare function ISODate(s?: string): Date;
declare function NumberLong(value: string | number): any;
declare function NumberInt(value: string | number): any;
declare function NumberDecimal(value: string | number): any;
declare function UUID(s?: string): any;
declare function BinData(subtype: number, base64: string): any;
declare function Timestamp(t?: number, i?: number): any;
declare var MinKey: any;
declare var MaxKey: any;
declare function print(...args: any[]): void;
declare function printjson(value: any): void;
`

/** `Database` member names already in the base — collections with these names
 *  are skipped to avoid a property/method merge conflict that would break the
 *  whole interface (they still surface as db methods). */
export const DATABASE_RESERVED = new Set([
  'getCollection', 'getSiblingDB', 'getCollectionNames', 'getCollectionInfos', 'getName',
  'version', 'runCommand', 'adminCommand', 'aggregate', 'stats', 'listCollections',
  'dropDatabase', 'createCollection', 'command', 'admin', 'watch'
])

const IDENT_RE = /^[A-Za-z_$][\w$]*$/

/**
 * Build the runtime `interface Database { … }` augmentation that types each
 * live collection as a `Collection` (so `db.<name>.find()...` chains resolve).
 * Only plain-identifier names are emitted — dotted/odd names can't be reached
 * as `db.<name>` anyway and the regex source still lists them. Returns '' when
 * there's nothing to add (keeps the worker from re-parsing an empty interface).
 */
export function buildCollectionDecls(names: string[]): string {
  const props = names
    .filter((n) => IDENT_RE.test(n) && !DATABASE_RESERVED.has(n))
    .map((n) => `  ${n}: Collection;`)
  return props.length ? `interface Database {\n${props.join('\n')}\n}\n` : ''
}
