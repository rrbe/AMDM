/**
 * Shared BSON ↔ EJSON corpus — the single source of truth for the type zoo.
 *
 * Each case carries a real BSON `value` plus the expected shape at every layer
 * of the data contract:
 *   - `ejson`   : EJSON-canonical wire form (what `serialize-core` must emit).
 *   - `type`    : semantic ValueType (what `ejson.ts#valueType` must return).
 *   - `display` : human display string (what `ejson.ts#formatScalar` must build).
 *   - `plain`   : collapsed plain value (what `resultCopy.ts#toPlainValue` emits).
 *
 * The expected `ejson` values were verified against bson's actual
 * EJSON.stringify(..., { relaxed: false }) output — not hand-guessed — so this
 * file pins the contract rather than echoing the implementation.
 *
 * Consumed by: test/unit/main/serialize-core.test.ts,
 * test/unit/renderer/ejson.test.ts, test/contract/ejson-roundtrip.test.ts.
 */
import {
  ObjectId,
  Long,
  Int32,
  Double,
  Decimal128,
  Binary,
  BSONRegExp,
  Timestamp,
  MinKey,
  MaxKey,
  Code,
  DBRef,
  UUID
} from 'bson'

const OID = '64b7f0f0f0f0f0f0f0f0f0f0'

export interface BsonCase {
  name: string
  /** A real BSON value. */
  value: unknown
  /** Expected EJSON-canonical wire form. */
  ejson: unknown
  /** Expected ValueType from ejson.ts. */
  type: string
  /** Expected formatScalar(...).text. */
  display: string
  /** Expected toPlainValue(...) (resultCopy.ts). */
  plain: unknown
}

/** Leaf/scalar type zoo — none of these are expandable in the tree. */
export const SCALAR_CASES: BsonCase[] = [
  {
    name: 'ObjectId',
    value: new ObjectId(OID),
    ejson: { $oid: OID },
    type: 'objectId',
    display: `ObjectId("${OID}")`,
    plain: OID
  },
  {
    name: 'Date',
    value: new Date('2024-01-02T03:04:05.000Z'),
    ejson: { $date: { $numberLong: '1704164645000' } },
    type: 'date',
    display: 'ISODate("2024-01-02T03:04:05.000Z")',
    plain: '2024-01-02T03:04:05.000Z'
  },
  {
    name: 'Long (out of safe-int range)',
    value: Long.fromString('9223372036854775807'),
    ejson: { $numberLong: '9223372036854775807' },
    type: 'long',
    display: 'NumberLong("9223372036854775807")',
    // Out of Number.isSafeInteger range → kept as a string to preserve precision.
    plain: '9223372036854775807'
  },
  {
    name: 'Int32',
    value: new Int32(42),
    ejson: { $numberInt: '42' },
    type: 'int',
    display: '42',
    plain: 42
  },
  {
    name: 'Double',
    value: new Double(3.5),
    ejson: { $numberDouble: '3.5' },
    type: 'double',
    display: '3.5',
    plain: 3.5
  },
  {
    name: 'Decimal128',
    value: Decimal128.fromString('1.50'),
    ejson: { $numberDecimal: '1.50' },
    type: 'decimal',
    display: 'NumberDecimal("1.50")',
    // Kept as a string to preserve trailing-zero precision.
    plain: '1.50'
  },
  {
    name: 'Binary (generic, subtype 0)',
    value: new Binary(Buffer.from('hi'), 0),
    ejson: { $binary: { base64: 'aGk=', subType: '00' } },
    type: 'binary',
    display: 'BinData(00, …)',
    plain: 'aGk='
  },
  {
    name: 'UUID (binary subtype 4)',
    value: new UUID('0123456789abcdef0123456789abcdef'),
    ejson: { $binary: { base64: 'ASNFZ4mrze8BI0VniavN7w==', subType: '04' } },
    type: 'binary',
    display: 'BinData(04, …)',
    plain: 'ASNFZ4mrze8BI0VniavN7w=='
  },
  {
    name: 'Regex',
    value: new BSONRegExp('ab', 'i'),
    ejson: { $regularExpression: { pattern: 'ab', options: 'i' } },
    type: 'regex',
    display: '/ab/i',
    plain: '/ab/i'
  },
  {
    name: 'Timestamp',
    value: new Timestamp({ t: 100, i: 2 }),
    ejson: { $timestamp: { t: 100, i: 2 } },
    type: 'timestamp',
    display: 'Timestamp(100, 2)',
    plain: { t: 100, i: 2 }
  },
  {
    name: 'MinKey',
    value: new MinKey(),
    ejson: { $minKey: 1 },
    type: 'minKey',
    display: 'MinKey',
    plain: 'MinKey'
  },
  {
    name: 'MaxKey',
    value: new MaxKey(),
    ejson: { $maxKey: 1 },
    type: 'maxKey',
    display: 'MaxKey',
    plain: 'MaxKey'
  },
  {
    name: 'Code',
    value: new Code('x=1'),
    ejson: { $code: 'x=1' },
    type: 'code',
    display: 'Code(x=1)',
    plain: 'x=1'
  },
  {
    name: 'DBRef',
    value: new DBRef('coll', new ObjectId(OID)),
    ejson: { $ref: 'coll', $id: { $oid: OID } },
    type: 'dbref',
    display: `DBRef("coll", ObjectId("${OID}"))`,
    plain: { $ref: 'coll', $id: OID }
  },
  // Plain JSON primitives (not BSON wrappers).
  { name: 'string', value: 'hi', ejson: 'hi', type: 'string', display: 'hi', plain: 'hi' },
  { name: 'boolean', value: true, ejson: true, type: 'boolean', display: 'true', plain: true },
  { name: 'null', value: null, ejson: null, type: 'null', display: 'null', plain: null }
]

/**
 * A representative document mixing types + nesting + arrays. Verified canonical
 * form, for round-trip / field-extraction / column-derivation tests.
 */
export const SAMPLE_DOC_VALUE = {
  _id: new ObjectId(OID),
  n: new Int32(7),
  tags: ['a', 'b'],
  nested: { city: 'x' }
}

export const SAMPLE_DOC_EJSON = {
  _id: { $oid: OID },
  n: { $numberInt: '7' },
  tags: ['a', 'b'],
  nested: { city: 'x' }
}
