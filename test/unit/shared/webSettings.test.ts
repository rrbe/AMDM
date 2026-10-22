import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types'
import { mergeWebSettings } from '../../../src/shared/webSettings'

describe('mergeWebSettings time zones', () => {
  it('accepts the app display time zone', () => {
    expect(mergeWebSettings(DEFAULT_SETTINGS, {
      dateTimeZone: 'Asia/Shanghai'
    })).toMatchObject({
      dateTimeZone: 'Asia/Shanghai'
    })
  })

  it('rejects unknown zones and fixed offsets', () => {
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: 'Not/AZone' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: '+08:00' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: 'UTC+08:00' })).toThrow('Invalid settings patch.')
    expect(() => mergeWebSettings(DEFAULT_SETTINGS, { dateTimeZone: 'Etc/GMT+8' })).toThrow('Invalid settings patch.')
  })
})

it('persists separate catalog and result sorting preferences', () => {
  expect(mergeWebSettings(DEFAULT_SETTINGS, {
    collectionSort: 'alphaDesc', resultFieldSort: 'natural', resultIdFirst: false
  })).toMatchObject({ collectionSort: 'alphaDesc', resultFieldSort: 'natural', resultIdFirst: false })
  expect(() => mergeWebSettings(DEFAULT_SETTINGS, { resultFieldSort: 'invalid' as never })).toThrow()
  expect(() => mergeWebSettings(DEFAULT_SETTINGS, { resultIdFirst: 'true' as never })).toThrow()
})
