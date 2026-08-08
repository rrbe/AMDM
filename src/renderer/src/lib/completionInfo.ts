import { snippetCompletion, type Completion } from '@codemirror/autocomplete'
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { classHighlighter, highlightCode } from '@lezer/highlight'

export interface CompletionDoc {
  signature: string
  summary: string
  example?: string
}

const METHOD_SNIPPETS: Record<string, string> = {
  find: 'find({ ${} })',
  findOne: 'findOne({ ${} })',
  aggregate: 'aggregate([ ${} ])',
  limit: 'limit(${10})',
  skip: 'skip(${0})',
  sort: 'sort({ ${field}: ${-1} })',
  project: 'project({ ${field}: ${1} })',
  projection: 'projection({ ${field}: ${1} })',
  countDocuments: 'countDocuments({ ${} })',
  distinct: 'distinct(${field})',
  insertOne: 'insertOne({ ${} })',
  insertMany: 'insertMany([ ${} ])',
  updateOne: 'updateOne({ ${filter} }, { $set: { ${} } })',
  updateMany: 'updateMany({ ${filter} }, { $set: { ${} } })',
  replaceOne: 'replaceOne({ ${filter} }, { ${} })',
  deleteOne: 'deleteOne({ ${} })',
  deleteMany: 'deleteMany({ ${} })',
  createIndex: 'createIndex({ ${field}: ${1} })',
  getSiblingDB: 'getSiblingDB(${db})',
  getCollection: 'getCollection(${name})',
  runCommand: 'runCommand({ ${} })'
}

const ZERO_ARG_METHODS = new Set([
  'toArray',
  'itcount',
  'count',
  'size',
  'pretty',
  'hasNext',
  'next',
  'explain',
  'getName',
  'getCollectionNames',
  'getCollectionInfos',
  'drop',
  'dropIndexes',
  'getIndexes',
  'indexes',
  'listIndexes',
  'stats',
  'admin',
  'estimatedDocumentCount'
])

const METHOD_DOCS: Record<string, CompletionDoc> = {
  find: {
    signature: 'find(query, projection?)',
    summary: 'Selects documents and returns a cursor.',
    example: 'db.products.find({ qty: { $gte: 25, $lt: 35 } })'
  },
  findOne: {
    signature: 'findOne(query, projection?)',
    summary: 'Returns the first document that matches the query.',
    example: 'db.products.findOne({ sku: "ABC-123" })'
  },
  aggregate: {
    signature: 'aggregate(pipeline, options?)',
    summary: 'Processes documents through an aggregation pipeline.',
    example: 'db.orders.aggregate([{ $match: { status: "open" } }, { $group: { _id: "$customerId" } }])'
  },
  sort: {
    signature: 'sort(specification)',
    summary: 'Orders cursor results by one or more fields.',
    example: 'db.products.find({}).sort({ createdAt: -1 })'
  },
  limit: {
    signature: 'limit(count)',
    summary: 'Limits the number of documents returned by the cursor.',
    example: 'db.products.find({}).limit(100)'
  },
  skip: {
    signature: 'skip(count)',
    summary: 'Skips documents before returning cursor results.',
    example: 'db.products.find({}).skip(100).limit(100)'
  },
  project: {
    signature: 'project(specification)',
    summary: 'Shapes fields returned by the cursor.',
    example: 'db.products.find({}).project({ name: 1, price: 1 })'
  },
  projection: {
    signature: 'projection(specification)',
    summary: 'Mongosh-compatible alias for cursor projection.',
    example: 'db.products.find({}).projection({ name: 1, price: 1 })'
  },
  countDocuments: {
    signature: 'countDocuments(query)',
    summary: 'Counts documents matching a query.',
    example: 'db.orders.countDocuments({ status: "open" })'
  },
  distinct: {
    signature: 'distinct(field, query?)',
    summary: 'Returns the distinct values for a field.',
    example: 'db.products.distinct("category", { active: true })'
  },
  insertOne: {
    signature: 'insertOne(document)',
    summary: 'Inserts one document into the collection.',
    example: 'db.products.insertOne({ name: "Notebook", price: 12 })'
  },
  insertMany: {
    signature: 'insertMany(documents)',
    summary: 'Inserts multiple documents into the collection.',
    example: 'db.products.insertMany([{ name: "Pen" }, { name: "Pencil" }])'
  },
  updateOne: {
    signature: 'updateOne(filter, update, options?)',
    summary: 'Updates the first document matching the filter.',
    example: 'db.products.updateOne({ sku: "ABC" }, { $set: { active: true } })'
  },
  updateMany: {
    signature: 'updateMany(filter, update, options?)',
    summary: 'Updates every document matching the filter.',
    example: 'db.products.updateMany({ active: false }, { $set: { archived: true } })'
  },
  replaceOne: {
    signature: 'replaceOne(filter, replacement, options?)',
    summary: 'Replaces the first document matching the filter.',
    example: 'db.products.replaceOne({ sku: "ABC" }, { sku: "ABC", active: true })'
  },
  deleteOne: {
    signature: 'deleteOne(filter)',
    summary: 'Deletes the first document matching the filter.',
    example: 'db.products.deleteOne({ sku: "ABC" })'
  },
  deleteMany: {
    signature: 'deleteMany(filter)',
    summary: 'Deletes every document matching the filter.',
    example: 'db.products.deleteMany({ archived: true })'
  },
  createIndex: {
    signature: 'createIndex(keys, options?)',
    summary: 'Creates an index on the collection.',
    example: 'db.products.createIndex({ sku: 1 }, { unique: true })'
  },
  getCollection: {
    signature: 'getCollection(name)',
    summary: 'Returns a collection, including names that are not valid identifiers.',
    example: 'db.getCollection("system.profile").find({})'
  },
  getSiblingDB: {
    signature: 'getSiblingDB(name)',
    summary: 'Returns another database on the same connection.',
    example: 'db.getSiblingDB("analytics").events.find({})'
  },
  runCommand: {
    signature: 'runCommand(command)',
    summary: 'Runs a database command.',
    example: 'db.runCommand({ ping: 1 })'
  },
  explain: {
    signature: 'explain(verbosity?)',
    summary: 'Returns the query execution plan.',
    example: 'db.products.find({ active: true }).explain("executionStats")'
  },
  toArray: {
    signature: 'toArray()',
    summary: 'Materializes all remaining cursor documents into an array.',
    example: 'db.products.find({ active: true }).toArray()'
  },
  maxTimeMS: {
    signature: 'maxTimeMS(milliseconds)',
    summary: 'Sets the server-side time limit for the cursor operation.',
    example: 'db.products.find({ active: true }).maxTimeMS(2000)'
  }
}

const CONSTRUCTOR_DOCS: Record<string, CompletionDoc> = {
  ObjectId: {
    signature: 'ObjectId(hex?)',
    summary: 'Creates a BSON ObjectId value.',
    example: 'db.products.findOne({ _id: ObjectId("507f1f77bcf86cd799439011") })'
  },
  ISODate: {
    signature: 'ISODate(value?)',
    summary: 'Creates a Date from an ISO-8601 string.',
    example: 'db.events.find({ createdAt: { $gte: ISODate("2026-01-01T00:00:00Z") } })'
  },
  Date: {
    signature: 'new Date(value?)',
    summary: 'Creates a JavaScript Date value.',
    example: 'db.events.find({ createdAt: { $lt: new Date("2026-01-01") } })'
  },
  NumberLong: {
    signature: 'NumberLong(value)',
    summary: 'Creates a BSON 64-bit integer.'
  },
  NumberInt: {
    signature: 'NumberInt(value)',
    summary: 'Creates a BSON 32-bit integer.'
  },
  NumberDecimal: {
    signature: 'NumberDecimal(value)',
    summary: 'Creates a BSON Decimal128 value.'
  },
  UUID: { signature: 'UUID(value?)', summary: 'Creates a BSON UUID value.' },
  Timestamp: {
    signature: 'Timestamp(time, increment)',
    summary: 'Creates a BSON timestamp value.'
  }
}

const OPERATOR_SUMMARIES: Record<string, string> = {
  $eq: 'Matches values equal to the specified value.',
  $ne: 'Matches values not equal to the specified value.',
  $gt: 'Matches values greater than the specified value.',
  $gte: 'Matches values greater than or equal to the specified value.',
  $lt: 'Matches values less than the specified value.',
  $lte: 'Matches values less than or equal to the specified value.',
  $in: 'Matches any value in the specified array.',
  $nin: 'Matches values not present in the specified array.',
  $match: 'Filters documents passed to the next aggregation stage.',
  $group: 'Groups documents and computes accumulated values.',
  $project: 'Shapes documents passed to the next aggregation stage.',
  $set: 'Sets fields in an update or aggregation pipeline.',
  $unset: 'Removes fields in an update or aggregation pipeline.'
}

function operatorDoc(label: string, detail: string | undefined): CompletionDoc {
  const summary = OPERATOR_SUMMARIES[label] ?? `MongoDB ${detail ?? 'operator'}.`
  if (detail === 'agg stage') {
    return {
      signature: `{ ${label}: expression }`,
      summary,
      example: `db.collection.aggregate([{ ${label}: { /* ... */ } }])`
    }
  }
  if (detail?.startsWith('update op')) {
    return {
      signature: `${label}: expression`,
      summary,
      example: `db.collection.updateOne({}, { ${label}: { field: value } })`
    }
  }
  return {
    signature: `${label}: value`,
    summary,
    example: `db.collection.find({ field: { ${label}: value } })`
  }
}

export function completionDoc(completion: Pick<Completion, 'label' | 'type' | 'detail'>): CompletionDoc | null {
  if (completion.type === 'method') {
    return (
      METHOD_DOCS[completion.label] ?? {
        signature: `${completion.label}(…)`,
        summary: `MongoDB ${completion.detail ?? 'shell'} method.`
      }
    )
  }
  if (completion.detail === 'constructor') return CONSTRUCTOR_DOCS[completion.label] ?? null
  if (completion.label.startsWith('$') && /(?:op|stage)/.test(completion.detail ?? '')) {
    return operatorDoc(completion.label, completion.detail)
  }
  return null
}

function appendHighlightedCode(parent: HTMLElement, code: string): void {
  const tree = javascriptLanguage.parser.parse(code)
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      if (!classes) {
        parent.append(document.createTextNode(text))
        return
      }
      const span = document.createElement('span')
      span.className = classes
      span.textContent = text
      parent.append(span)
    },
    () => parent.append(document.createTextNode('\n'))
  )
}

function renderCompletionInfo(doc: CompletionDoc): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-completion-doc'

  const signature = document.createElement('code')
  signature.className = 'cm-completion-doc-signature'
  appendHighlightedCode(signature, doc.signature)
  root.append(signature)

  const summary = document.createElement('p')
  summary.textContent = doc.summary
  root.append(summary)

  if (doc.example) {
    const exampleLabel = document.createElement('div')
    exampleLabel.className = 'cm-completion-doc-label'
    exampleLabel.textContent = 'Example'
    root.append(exampleLabel)

    const pre = document.createElement('pre')
    const code = document.createElement('code')
    appendHighlightedCode(code, doc.example)
    pre.append(code)
    root.append(pre)
  }

  return root
}

/** Attach CodeMirror's side info panel without changing insertion behavior. */
export function withCompletionInfo(completion: Completion): Completion {
  if (completion.info) return completion
  const doc = completionDoc(completion)
  return doc ? { ...completion, info: () => renderCompletionInfo(doc) } : completion
}

/** The same method/snippet behavior is used by both TS and regex completion. */
export function methodCompletion(label: string, detail?: string, boost?: number): Completion {
  const completion: Completion = { label, type: 'method', detail, boost }
  if (ZERO_ARG_METHODS.has(label)) {
    return withCompletionInfo({ ...completion, apply: `${label}()` })
  }
  const template = METHOD_SNIPPETS[label] ?? `${label}(\${})`
  return withCompletionInfo(snippetCompletion(template, completion))
}
