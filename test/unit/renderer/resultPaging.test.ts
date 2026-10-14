import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type ShellResult } from '../../../src/shared/types'
import { createTab } from '../../../src/renderer/src/lib/tabs'
import { useAppStore } from '../../../src/renderer/src/store/useAppStore'

const result = (id: string, pageSize = 50): ShellResult => ({
  kind: 'documents', data: [{n:1}], count: 1, resultId: id, pageSize, skip: 0,
  pageable: true, truncated: true, totalStatus: 'known', totalCount: 100
})
const execute = vi.fn()
const page = vi.fn()
const release = vi.fn()
const total = vi.fn()
const update = vi.fn()
const query = 'db.items.find().limit(100)'

beforeEach(() => {
  vi.stubGlobal('window', { api: {
    shell: { execute, page, release, total, abort: vi.fn().mockResolvedValue(true) },
    settings: { update }, history: { list: vi.fn().mockResolvedValue([]) }
  } })
  release.mockResolvedValue(undefined)
  useAppStore.setState({ tabs: [createTab('tab', {connectionId:'c',code:query,activeDatabase:'db'})], activeTabId:'tab', settings:DEFAULT_SETTINGS, notifications:[] })
  vi.clearAllMocks()
  execute.mockResolvedValue(result('backend'))
  page.mockImplementation(async (request) => ({...result(request.resultId,request.pageSize),skip:request.skip}))
})
afterEach(() => {
  useAppStore.setState({ tabs: [createTab('empty')], activeTabId:'empty' })
  vi.unstubAllGlobals()
})

describe('display pagination', () => {
  it('changes only the focused display size, without updating query text, defaults, execution time, or history', async () => {
    await useAppStore.getState().runShell()
    const initial = useAppStore.getState().tabs[0].results[0]
    await useAppStore.getState().setResultPageSize(10)
    expect(execute).toHaveBeenCalledOnce()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({resultId:'backend',pageSize:10,skip:0}))
    expect(update).not.toHaveBeenCalled()
    expect(useAppStore.getState().tabs[0]).toMatchObject({ code:query, results:[{id:initial.id,executedAt:initial.executedAt,result:{pageSize:10}}] })
    expect(useAppStore.getState().settings.queryLimit).toBe(50)
  })

  it('retains paging state per result and patches the correct result if focus switches during a page read', async () => {
    await useAppStore.getState().runShell()
    const first = useAppStore.getState().tabs[0].activeResultId!
    execute.mockResolvedValue(result('second',20))
    await useAppStore.getState().runShell()
    const second = useAppStore.getState().tabs[0].activeResultId!
    useAppStore.getState().setActiveResultTab(first)
    let finish!: (value: ShellResult) => void
    page.mockImplementation(() => new Promise(resolve=>{finish=resolve}))
    const reading = useAppStore.getState().loadPage(50)
    useAppStore.getState().setActiveResultTab(second)
    finish({...result('backend'),skip:50})
    await reading
    expect(useAppStore.getState().tabs[0].results).toMatchObject([{skip:50,result:{pageSize:50}}, {skip:0,result:{pageSize:20}}])
  })

  it('preserves displayed documents and the display size if fetching a page fails', async () => {
    await useAppStore.getState().runShell()
    const initial = useAppStore.getState().tabs[0].results[0].result
    page.mockResolvedValue({kind:'error',error:'cursor expired',failureKind:'execution'})
    await useAppStore.getState().setResultPageSize(100)
    expect(useAppStore.getState().tabs[0].results[0].result).toBe(initial)
    expect(useAppStore.getState().notifications).toHaveLength(1)
  })

  it('releases results on refresh, eviction, and tab/result closure', async () => {
    await useAppStore.getState().runShell()
    execute.mockResolvedValue(result('fresh'))
    await useAppStore.getState().refreshResult()
    expect(release).toHaveBeenCalledWith('backend')
    const refreshed = useAppStore.getState().tabs[0].activeResultId!
    useAppStore.getState().closeResultTab(refreshed)
    expect(release).toHaveBeenCalledWith('fresh')
    for (let i=0;i<9;i++) {
      execute.mockResolvedValue(result(`run-${i}`))
      await useAppStore.getState().runShell()
    }
    expect(release).toHaveBeenCalledWith('run-0')
    useAppStore.getState().closeTab('tab')
    expect(release).toHaveBeenCalledWith('run-8')
  })

  it('releases a late execution handle after its query tab closes', async () => {
    let finish!: (value: ShellResult) => void
    execute.mockImplementationOnce(() => new Promise(resolve=>{finish=resolve}))
    const running = useAppStore.getState().runShell()
    useAppStore.getState().closeTab('tab')
    finish(result('late'))
    await running
    expect(release).toHaveBeenCalledWith('late')
    expect(useAppStore.getState().tabs[0].results).toEqual([])
  })

  it('does not notify or restore a result that is closed during a page request', async () => {
    await useAppStore.getState().runShell()
    let finish!: (value: ShellResult) => void
    page.mockImplementation(() => new Promise(resolve=>{finish=resolve}))
    const reading = useAppStore.getState().loadPage(50)
    useAppStore.getState().closeResultTab(useAppStore.getState().tabs[0].activeResultId!)
    finish({kind:'error',error:'Result is closed',failureKind:'execution'})
    await reading
    expect(useAppStore.getState().tabs[0].results).toEqual([])
    expect(useAppStore.getState().notifications).toEqual([])
  })

  it('does not overwrite a confirmed total with a late count response from the same result', async () => {
    let finish!: (value: {totalStatus:'known';totalCount:number}) => void
    total.mockImplementation(() => new Promise(resolve=>{finish=resolve}))
    execute.mockResolvedValue({...result('backend'),totalStatus:'counting',totalCount:undefined})
    await useAppStore.getState().runShell()
    page.mockResolvedValue({...result('backend'),totalCount:80,truncated:false})
    await useAppStore.getState().loadPage(50)
    finish({totalStatus:'known',totalCount:100})
    await Promise.resolve()
    expect(useAppStore.getState().tabs[0].results[0].result.totalCount).toBe(80)
  })
})
