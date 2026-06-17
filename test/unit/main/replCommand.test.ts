/**
 * Pure parsing of mongosh REPL commands (`show …`, `use …`). The actual driver
 * translation (runReplCommand) is covered in the integration suite.
 */
import { describe, it, expect } from 'vitest'
import { parseReplCommand } from '../../../src/main/mongo/shellCore'

describe('parseReplCommand', () => {
  it('parses show commands (case-insensitive, trailing semicolon)', () => {
    expect(parseReplCommand('show dbs')).toEqual({ type: 'show', what: 'dbs' })
    expect(parseReplCommand('SHOW Databases')).toEqual({ type: 'show', what: 'databases' })
    expect(parseReplCommand('show collections;')).toEqual({ type: 'show', what: 'collections' })
    expect(parseReplCommand('  show users  ')).toEqual({ type: 'show', what: 'users' })
  })

  it('parses use <db>', () => {
    expect(parseReplCommand('use mydb')).toEqual({ type: 'use', db: 'mydb' })
    expect(parseReplCommand('use my-db_2;')).toEqual({ type: 'use', db: 'my-db_2' })
  })

  it('returns null for ordinary JS or mixed scripts', () => {
    expect(parseReplCommand('db.users.find()')).toBeNull()
    expect(parseReplCommand('use mydb\ndb.x.find()')).toBeNull() // not a whole-script command
    expect(parseReplCommand('showtime()')).toBeNull()
    expect(parseReplCommand('show xyz')).toBeNull() // unknown subcommand
  })
})
