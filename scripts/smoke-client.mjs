/**
 * Client 半冒烟测试。
 *
 * 两件事：
 *  1. 执行 `apply()`，确认注入过程没有警告（之前的 bug 全是注入阶段炸的）；
 *  2. **真的把每个注册到槽位里的组件调用一次**，用一个贴近真实形状的 store 快照，
 *     走完各组件的渲染体 —— 只执行 apply 是测不到组件的（`CategoriesPanel` 里写错一个
 *     标识符照样能过）。
 *
 * 这里没有真 React：`createElement` 只造普通对象，hook 用桩。所以它抓的是
 * 「渲染体里有不存在的东西 / 数据形状变了」，不是 DOM 行为。
 */
import { readFileSync } from 'node:fs'

const el = () => ({
  style: {}, dataset: {}, children: [], hidden: false, id: '', className: '',
  setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {},
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  insertBefore() {}, getAttribute: () => null, classList: { add() {}, remove() {}, toggle() {} },
  textContent: '', innerHTML: '',
})
const head = el()
const body = el()
const fakeRow = el()
fakeRow.parentElement = { ...el(), insertBefore() {}, parentElement: null }
globalThis.__warns = []
console.warn = (...args) => { globalThis.__warns.push(args.join(' ')) }
globalThis.document = {
  head, body,
  documentElement: el(),
  createElement: () => el(),
  getElementById: () => null,
  querySelector: (sel) => (String(sel).includes('data-row-key') ? fakeRow : null),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  visibilityState: 'visible',
}
globalThis.window = {
  innerWidth: 1400, innerHeight: 900,
  addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ overflowY: 'auto' }),
  __ModuleLoader__: { load: ({ factory }) => { globalThis.__factory = factory } },
}
globalThis.getComputedStyle = () => ({ overflowY: 'auto' })
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.localStorage = { getItem: () => null, setItem() {} }

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect() {}, useLayoutEffect() {}, useMemo: (f) => f(), useCallback: (f) => f,
  useRef: (v) => ({ current: v }),
  // 组件靠它拿 store 快照；返回值由 fakeState 决定，好让渲染体走「有数据」那条路
  useSyncExternalStore: () => globalThis.__fakeState,
  createContext: () => ({ Provider: 'P', Consumer: 'C' }),
}
const fakeRequire = (name) => (name === 'react' ? React : {})

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
new Function('window', 'document', 'React', 'require', src)(globalThis.window, globalThis.document, React, fakeRequire)

const factory = globalThis.__factory
if (!factory) { console.error('factory 未注册'); process.exit(1) }
const mod = factory(fakeRequire)
console.log('exports:', Object.keys(mod))

// —— 一份贴近真实的 store 快照：分类、会话、归属、建议、设置、用量都有内容 ——
const categories = [
  { id: 'c1', name: '线上问题排查', color: '#c9a227', order: 0, createdAt: 1, archived: false },
  { id: 'c2', name: '工单排查', color: '#d95c8a', order: 1, createdAt: 2, archived: false },
  { id: 'c3', name: '归档分类', color: '#7a869a', order: 1000, createdAt: 3, archived: true },
]
const sessions = Array.from({ length: 25 }, (_, i) => ({
  id: `s${i}`,
  title: `会话 ${i} 排查线上 502`,
  createdAt: 1000 + i,
  updatedAt: 2000 + i,
  cwd: '/tmp',
  live: i === 0,
  workspace: { id: 'w1', title: 'dsh' },
}))
const assignments = { s0: 'c1', s1: 'c1', s2: 'c2' }
const hints = { s3: { candidates: [{ categoryId: 'c1', confidence: 0.8, at: 1 }], updatedAt: 1 } }
const titleHints = { s4: { title: '排查 EKS 容器流量', at: 1 } }
globalThis.__fakeState = {
  __t: (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key),
  __openSession() {},
  phase: 'ready',
  error: '',
  data: {
    categories,
    sessions,
    assignments,
    settings: {
      autoClassify: true, showRowMark: true, costRange: 'day',
      turnCount: 2, titleCheckEvery: 1, minConfidence: 0.35,
      filterSort: 'activity', newSessionWorkspaceId: 'w1',
    },
    hints,
    titleHints,
    usage: {
      auto: { calls: 12, inputTokens: 34000, outputTokens: 5200, costUsd: 0.09, costCny: 0.64 },
      manual: { calls: 3, inputTokens: 4000, outputTokens: 900, costUsd: 0.01, costCny: 0.07 },
      periods: {
        day: { auto: { calls: 4, inputTokens: 9000, outputTokens: 1200, costCny: 0.2 }, manual: { calls: 1, costCny: 0.03 } },
        week: { auto: { calls: 9, costCny: 0.5 }, manual: { calls: 2, costCny: 0.06 } },
        month: { auto: { calls: 12, costCny: 0.64 }, manual: { calls: 3, costCny: 0.07 } },
      },
    },
    sessionsLoaded: true,
  },
  hints,
  titleHints,
  hintCategories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  moveTarget: null,
  titleTarget: null,
  callsOpen: false,
  filterCategory: '',
  filterOpen: false,
  filterAnchor: null,
  preview: null,
  toast: '',
  busy: '',
  workspaceId: '',
  collapsed: {},
  expanded: {},
  archivedView: false,
  dataAt: Date.now(),
}

const cleanups = []
const components = []
const ctx = {
  effect(fn) { const r = fn(); if (typeof r === 'function') cleanups.push(r); return () => {} },
  on() { return () => {} },
  get() { return undefined },
  slots: {
    inject(key, cb) { cb() },
    register(meta, component) {
      components.push({ name: meta?.id ?? meta?.key ?? '(anonymous)', component })
      return () => {}
    },
  },
  locale: {
    register() { return () => {} },
    bind: () => globalThis.__fakeState.__t,
    getLocale: () => ({ id: 'zh' }),
  },
  layout: { selectPanel() {} },
  uiWorkspace: { openSession() {} },
}
try {
  mod.apply(ctx)
  if (globalThis.__warns.length > 0) {
    console.error('❌ apply 期间出现警告（通常代表注入失败）：', globalThis.__warns)
    process.exit(1)
  }
  console.log('✅ apply 执行成功，无警告')
} catch (error) {
  console.error('❌ apply 抛错：', error)
  process.exit(1)
}

// 让所有「只有某种状态才渲染」的组件都进入渲染体：弹窗目标、筛选清单都摆上数据
globalThis.__fakeState.moveTarget = { sessionId: 's0', displayTitle: '会话 0', x: 40, y: 60 }
globalThis.__fakeState.titleTarget = { sessionId: 's0', displayTitle: '会话 0' }
globalThis.__fakeState.filterOpen = true
globalThis.__fakeState.filterAnchor = { x: 10, y: 20, right: 300, bottom: 52 }

// —— 逐个渲染：这一步才是「组件里写错东西」的兜底 ——
let rendered = 0
const failures = []
for (const { name, component } of components) {
  try {
    // 组件需要的数据全从 store 快照来，props 只给最常用的那几个
    const sessionId = name === 'session-category-hint' ? 's3' : 's0'
    const tree = component({
      sessionId,
      displayTitle: '会话 0 排查线上 502',
      closePanel() {},
      onClose() {},
      limit: 4,
    })
    if (tree === undefined || tree === null) {
      failures.push(`${name}: 渲染返回空（数据齐备时不该为空）`)
      continue
    }
    rendered += 1
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : String(error)}`)
  }
}
console.log(`渲染组件 ${rendered}/${components.length} 个`)

// —— 第二轮：启动阶段的 lite data（只拉过 /hints，会话清单还没到）——
// 这条分支最容易崩：面板显示加载态、筛选清单显示占位行、色标仍然要能画出来。
const fullData = globalThis.__fakeState.data
globalThis.__fakeState.data = {
  ...fullData,
  sessions: [],
  sessionsLoaded: false,
  usage: null,
}
let liteRendered = 0
for (const { name, component } of components) {
  try {
    const sessionId = name === 'session-category-hint' ? 's3' : 's0'
    const tree = component({ sessionId, displayTitle: '会话 0', closePanel() {}, onClose() {}, limit: 4 })
    if (tree === undefined || tree === null) {
      failures.push(`${name}: lite data 下渲染返回空`)
      continue
    }
    liteRendered += 1
  } catch (error) {
    failures.push(`${name}: lite data 下抛错 - ${error && error.message ? error.message : String(error)}`)
  }
}
globalThis.__fakeState.data = fullData
console.log(`lite data 渲染 ${liteRendered}/${components.length} 个`)

if (failures.length > 0) {
  console.error('❌ 组件渲染失败：')
  for (const line of failures) console.error('   -', line)
  process.exit(1)
}
console.log('✅ 全部组件渲染通过')
