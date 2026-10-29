/**
 * Host 半的行为自检（不需要真 DSH 宿主）。
 *
 * 每个用例都用一个临时 `DSH_HOME` + 桩 `ctx` 真的跑一遍 `apply()`，
 * 再用假的 req/res 调真实路由，所以测的是线上同一份代码路径。
 *
 * 覆盖：状态文件损坏的降级与恢复、seed 语义、写接口来源校验、
 *      `/hint` 采纳指定分类、素材字数预算、兜底标题跳过注入消息。
 *
 * 跑法：`node scripts/check-host.mjs`
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const mod = await import(join(PLUGIN_DIR, 'index.js'))

/** 只回空的 sessionQuery：让「不关心会话」的用例也能正常走 /state。 */
const EMPTY_SESSION_QUERY = {
  listSessions: async () => [],
  readTitleSnapshots: async () => [],
  readTitleSnapshot: async () => ({ title: { title: '', source: { kind: '' } } }),
  listEvents: async () => [],
  readEvent: async () => ({}),
  readSurface: async () => ({ events: [] }),
}

let failed = 0
const ok = (name, pass, detail = '') => {
  if (pass) console.log(`✅ ${name}`)
  else {
    failed += 1
    console.error(`❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/** 一套临时环境：独立的 DSH_HOME + 独立的 ctx（路由表各自一份）。 */
function makeEnv(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-check-'))
  process.env.DSH_HOME = home
  const dir = join(home, 'storages', 'dsh-session-categories')
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'state.json')
  // 必须在 apply 之前把状态文件摆好：apply 内部会立刻 load()，
  // apply 之后再写文件等于在跟它抢读，测出来的结果不可信。
  if (options.stateFile !== undefined) writeFileSync(statePath, options.stateFile)
  const routes = new Map()
  const ctx = {
    effect(fn) {
      const result = fn()
      return typeof result === 'function' ? result : () => {}
    },
    on() {
      return () => {}
    },
    get(name) {
      if (name === 'sessionQuery') return options.sessionQuery ?? EMPTY_SESSION_QUERY
      if (name === 'llm') return options.llm
      return undefined
    },
    webServer: {
      register(definition) {
        routes.set(definition.path, definition.handler)
        return () => {}
      },
    },
    logger: { info() {}, warn() {} },
  }
  mod.apply(ctx, options.config ?? {})
  const call = async (path, { method = 'GET', body = null, headers = {} } = {}) => {
    const handler = routes.get(path)
    if (!handler) throw new Error(`没有注册路由：${path}`)
    const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json', ...headers },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    }
    let status = 0
    let payload = ''
    const res = {
      headersSent: false,
      writeHead(value) {
        status = value
        this.headersSent = true
      },
      end(value) {
        payload = String(value ?? '')
      },
    }
    await handler(req, res)
    return { status, json: payload ? JSON.parse(payload) : null }
  }
  const callRaw = async (path, { method = 'POST', raw = '' } = {}) => {
    const handler = routes.get(path)
    if (!handler) throw new Error(`没有注册路由：${path}`)
    const req = {
      method,
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(raw)
      },
    }
    let status = 0
    let payload = ''
    const res = {
      headersSent: false,
      writeHead(value) {
        status = value
        this.headersSent = true
      },
      end(value) {
        payload = String(value ?? '')
      },
    }
    await handler(req, res)
    return { status, json: payload ? JSON.parse(payload) : null }
  }
  return { home, dir, statePath, call, callRaw, routes }
}

const state = (extra = {}) => ({ categories: [], assignments: {}, settings: {}, ...extra })

// ---------------------------------------------------------------- 1. 坏文件不把插件钉死
{
  const env = makeEnv({ config: { seedCategories: ['工作'] }, stateFile: '{ this is not json' })
  const first = await env.call('/dsh-session-categories/api/state')
  ok('损坏的 state.json 自动降级（不再永久 500）', first.status === 200, `实际 ${first.status}`)
  ok(
    '坏文件被备份成 state.json.bad-*',
    readdirSync(env.dir).some((name) => name.includes('.bad-')),
  )
  writeFileSync(env.statePath, JSON.stringify(state()))
  const second = await env.call('/dsh-session-categories/api/state')
  ok('修好文件后立刻能读', second.status === 200, `实际 ${second.status}`)
}

// ---------------------------------------------------------------- 2. seed 只在首次运行
{
  const env = makeEnv({ config: { seedCategories: ['工作', '排查'] }, stateFile: JSON.stringify(state()) })
  await env.call('/dsh-session-categories/api/settings', { method: 'POST', body: { minConfidence: 0.4 } })
  const saved = JSON.parse(readFileSync(env.statePath, 'utf8'))
  ok('分类删空后重启不会被 seed 复活', saved.categories.length === 0, `实际 ${JSON.stringify(saved.categories)}`)

  const fresh = makeEnv({ config: { seedCategories: ['工作', '排查'] } })
  await fresh.call('/dsh-session-categories/api/settings', { method: 'POST', body: { minConfidence: 0.4 } })
  const seeded = JSON.parse(readFileSync(fresh.statePath, 'utf8'))
  ok('首次运行（没有文件）仍然写入 seed', seeded.categories.length === 2, `实际 ${seeded.categories.length}`)
}

// ---------------------------------------------------------------- 3. 写接口来源校验
{
  const env = makeEnv({ config: { seedCategories: ['工作'] } })
  const path = '/dsh-session-categories/api/settings'
  const evil = await env.call(path, {
    method: 'POST',
    body: {},
    headers: { origin: 'https://evil.example' },
  })
  ok('跨站 Origin 的写请求被拒（403）', evil.status === 403, `实际 ${evil.status}`)
  ok('跨站被拒时带错误码', evil.json?.code === 'host.crossOrigin', `实际 ${evil.json?.code}`)
  const textPlain = await env.call(path, { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })
  ok('非 JSON Content-Type 被拒（415）', textPlain.status === 415, `实际 ${textPlain.status}`)
  const sameOrigin = await env.call(path, {
    method: 'POST',
    body: { minConfidence: 0.4 },
    headers: { origin: 'http://127.0.0.1:1' },
  })
  ok('同源写请求放行（200）', sameOrigin.status === 200, `实际 ${sameOrigin.status}`)
}

// ---------------------------------------------------------------- 4. /hint 采纳用户选的分类
{
  const env = makeEnv({
    stateFile: JSON.stringify(
      state({
        categories: [
          { id: 'cA', name: 'A', color: '#000', order: 0, createdAt: 1, archived: false },
          { id: 'cB', name: 'B', color: '#111', order: 1, createdAt: 2, archived: false },
        ],
        hints: { s1: { candidates: [{ categoryId: 'cA', confidence: 0.9, at: 1 }], updatedAt: 1 } },
      }),
    ),
  })
  // 候选里只有 cA，用户在「换分类」里选了 cB
  const picked = await env.call('/dsh-session-categories/api/hint', {
    method: 'POST',
    body: { action: 'accept', sessionId: 's1', categoryId: 'cB' },
  })
  ok('采纳的是用户选的分类，不是「第一条候选」', picked.json?.assignments?.s1 === 'cB', `实际 ${picked.json?.assignments?.s1}`)
  const bogus = await env.call('/dsh-session-categories/api/hint', {
    method: 'POST',
    body: { action: 'accept', sessionId: 's1', categoryId: 'nope' },
  })
  ok('不存在的分类被拒（400）', bogus.status === 400, `实际 ${bogus.status}`)
}

// ---------------------------------------------------------------- 5. 素材预算 + 注入过滤
{
  const events = []
  for (let index = 0; index < 200; index += 1) {
    events.push({
      type: 'user/message',
      seq: index * 3 + 1,
      data: { content: [{ type: 'text', text: '<system-reminder>工作区规则</system-reminder>' }], source: { kind: 'agent-instructions' } },
    })
    events.push({
      type: 'user/message',
      seq: index * 3 + 2,
      data: { content: [{ type: 'text', text: `第${index}轮：${'A'.repeat(180)}` }], source: { kind: 'user' } },
    })
    events.push({
      type: 'assistant/message',
      seq: index * 3 + 3,
      data: { message: { content: [{ type: 'text', text: `第${index}轮回复：${'B'.repeat(600)}` }] } },
    })
  }
  let captured = ''
  const llm = {
    async *stream(options) {
      captured = options.messages[0].content[0].text
      yield { type: 'text-delta', text: '[]' }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const sessionQuery = {
    listSessions: async () => [{ header: { id: 'sX', createdAt: 1, cwd: '/tmp' }, live: false }],
    readTitleSnapshots: async (ids) => ids.map((sessionId) => ({ status: 'fulfilled', sessionId, value: { title: { title: '测试会话' } } })),
    readTitleSnapshot: async () => ({ title: { title: '测试会话', source: { kind: 'generated' } } }),
    listEvents: async () => events,
    readEvent: async ({ seq }) => ({ target: { data: events.find((event) => event.seq === seq)?.data } }),
    readSurface: async () => ({ events }),
  }
  const env = makeEnv({
    sessionQuery,
    llm,
    config: { seedCategories: ['工作'], provider: 'p', model: 'm' },
    stateFile: JSON.stringify(
      state({
        categories: [{ id: 'c1', name: '工作', color: '#000', order: 0, createdAt: 1, archived: false }],
        // turnCount = 0（全部）才是预算真正吃紧的场景
        settings: { turnCount: 0, autoClassify: true },
      }),
    ),
  })
  // /classify 已按「无界面调用的死路由」移除，这里改走 /classify-session（同一条素材/调用链）
  await env.call('/dsh-session-categories/api/classify-session', { method: 'POST', body: { sessionId: 'sX' } })
  ok('素材被字数预算截断并注明省略', /更早的 \d+ 轮已省略/.test(captured), `prompt ${captured.length} 字`)
  ok('素材长度控制在预算量级', captured.length < 14000, `实际 ${captured.length} 字`)
  ok('注入的上下文没有混进素材', !captured.includes('工作区规则'))
  ok('最旧的轮次被丢掉、最新的保留', !captured.includes('第0轮：') && captured.includes('第199轮：'))
  ok('助手长回复被裁剪', captured.includes('…（中间略）…'))
}

// ---------------------------------------------------------------- 6. 兜底标题跳过注入消息
{
  const events = [
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'Current runtime context: 工作区规则' }], source: { kind: 'agent-instructions' } } },
    { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: '把 Term B 的 90 个班费用说明改一下' }], source: { kind: 'user' } } },
  ]
  const sessionQuery = {
    listSessions: async () => [{ header: { id: 'sNone', createdAt: 1, cwd: '/tmp' }, live: false }],
    readTitleSnapshots: async (ids) => ids.map((sessionId) => ({ status: 'fulfilled', sessionId, value: { title: { title: '' } } })),
    listEvents: async () => events,
    readEvent: async ({ seq }) => ({ target: { data: events.find((event) => event.seq === seq)?.data } }),
    readSurface: async () => ({ events }),
  }
  const env = makeEnv({ sessionQuery, config: { seedCategories: ['工作'] } })
  const result = await env.call('/dsh-session-categories/api/state')
  const title = result.json?.sessions?.[0]?.title ?? ''
  ok('兜底标题用的是真人第一句话', title.startsWith('把 Term B'), `实际「${title}」`)
}

// ---------------------------------------------------------------- 7. DNS rebinding
{
  const env = makeEnv({ config: { seedCategories: ['工作'] } })
  const path = '/dsh-session-categories/api/settings'
  const rebound = await env.call(path, {
    method: 'POST',
    body: {},
    // 攻击者域名解析到 127.0.0.1：Host 与 Origin 一致，但都不是本机
    headers: { host: 'evil.example:51040', origin: 'http://evil.example:51040' },
  })
  ok('DNS rebinding（Host 非回环）被拒', rebound.status === 403, `实际 ${rebound.status}`)
  const readRebound = await env.call('/dsh-session-categories/api/state', {
    headers: { host: 'evil.example:51040' },
  })
  ok('DNS rebinding 读 /state 也被拒（不给会话标题）', readRebound.status === 403, `实际 ${readRebound.status}`)
  const loopback = await env.call(path, {
    method: 'POST',
    body: { minConfidence: 0.4 },
    headers: { host: 'localhost:51040', origin: 'http://localhost:51040' },
  })
  ok('localhost 正常放行', loopback.status === 200, `实际 ${loopback.status}`)
}

// ---------------------------------------------------------------- 8. 非法 JSON → 400
{
  const env = makeEnv({ config: { seedCategories: ['工作'] } })
  const handler = env.routes?.get?.('/dsh-session-categories/api/settings')
  // makeEnv 没有暴露 routes，这里用 call 的原始通道：直接构造畸形 body
  const bad = await env.callRaw('/dsh-session-categories/api/settings', { method: 'POST', raw: '{"turnCount":' })
  ok('非法 JSON 返回 400（不是 500）', bad.status === 400, `实际 ${bad.status}`)
  ok('非法 JSON 带错误码（客户端可翻译）', bad.json?.code === 'body.invalidJson', `实际 ${bad.json?.code}`)
  void handler
}

// ---------------------------------------------------------------- 9. 同一会话不并发花钱
{
  let calls = 0
  let concurrent = 0
  let maxConcurrent = 0
  const llm = {
    async *stream() {
      calls += 1
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 120))
      concurrent -= 1
      yield { type: 'text-delta', text: '[]' }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const events = [{ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '排查线上 502' }], source: { kind: 'user' } } }]
  const sessionQuery = {
    listSessions: async () => [{ header: { id: 'sX', createdAt: 1, cwd: '/tmp' }, live: false }],
    readTitleSnapshots: async (ids) => ids.map((sessionId) => ({ status: 'fulfilled', sessionId, value: { title: { title: '排查 502' } } })),
    readTitleSnapshot: async () => ({ title: { title: '排查 502', source: { kind: 'generated' } } }),
    listEvents: async () => events,
    readEvent: async () => ({ target: { data: events[0].data } }),
    readSurface: async () => ({ events }),
  }
  let listener = null
  const routes = new Map()
  const ctx = {
    effect(fn) { const r = fn(); return typeof r === 'function' ? r : () => {} },
    on(name, fn) { if (name === 'session/event') listener = fn; return () => {} },
    get(name) { return name === 'sessionQuery' ? sessionQuery : name === 'llm' ? llm : undefined },
    webServer: { register(d) { routes.set(d.path, d.handler); return () => {} } },
    logger: { info() {}, warn() {} },
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-conc-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'storages', 'dsh-session-categories'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'dsh-session-categories', 'state.json'),
    JSON.stringify({
      categories: [{ id: 'c1', name: '工作', color: '#000', order: 0, createdAt: 1, archived: false }],
      assignments: {},
      settings: { autoClassify: true, turnCount: 1, titleCheckEvery: 0 },
    }),
  )
  mod.apply(ctx, { provider: 'p', model: 'm' })
  const turnEnd = (turn) => listener({ id: 'sX', header: {} }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  turnEnd(1)
  await new Promise((resolve) => setTimeout(resolve, 830)) // 第一次调用已经开始
  turnEnd(2) // 运行中又来一轮
  await new Promise((resolve) => setTimeout(resolve, 600))
  ok('同一会话运行中来的新一轮被合并（只花一次钱）', calls === 1, `实际调用 ${calls} 次`)
  ok('没有并发调用', maxConcurrent <= 1, `最大并发 ${maxConcurrent}`)
}

// ---------------------------------------------------------------- 10. 孤儿清理的保护
{
  const env = makeEnv({
    config: { seedCategories: ['工作'] },
    // 会话列表读成空：绝对不能据此把归属全删了
    sessionQuery: { ...EMPTY_SESSION_QUERY, listSessions: async () => [] },
    stateFile: JSON.stringify(
      state({
        categories: [{ id: 'c1', name: '工作', color: '#000', order: 0, createdAt: 1, archived: false }],
        assignments: { ghost: 'c1' },
        ignored: { ghost2: 1 },
      }),
    ),
  })
  await env.call('/dsh-session-categories/api/state')
  await new Promise((resolve) => setTimeout(resolve, 120))
  const saved = JSON.parse(readFileSync(env.statePath, 'utf8'))
  ok('会话列表为空时不清理（保护性跳过）', Object.keys(saved.assignments ?? {}).length === 1, `实际 ${JSON.stringify(saved.assignments)}`)
}

// ---------------------------------------------------------------- 11. 会话清单的磁盘种子
{
  const home = mkdtempSync(join(tmpdir(), 'dsh-seed-'))
  process.env.DSH_HOME = home
  const dir = join(home, 'storages', 'dsh-session-categories')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'sessions-cache.json'),
    JSON.stringify({
      at: Date.now() - 3600_000,
      sessions: [{ id: 'old1', title: '昨天那条会话', createdAt: 1, updatedAt: 2, cwd: '/tmp', live: false, workspace: null }],
    }),
  )
  let listCalls = 0
  const slowQuery = {
    ...EMPTY_SESSION_QUERY,
    listSessions: async () => {
      listCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 200))
      return []
    },
  }
  const routes = new Map()
  const ctx = {
    effect(fn) { const r = fn(); return typeof r === 'function' ? r : () => {} },
    on() { return () => {} },
    get(name) { return name === 'sessionQuery' ? slowQuery : undefined },
    webServer: { register(d) { routes.set(d.path, d.handler); return () => {} } },
    logger: { info() {}, warn() {} },
  }
  mod.apply(ctx, { seedCategories: ['工作'] })
  const handler = routes.get('/dsh-session-categories/api/state')
  const started = Date.now()
  let payload = ''
  const req = { method: 'GET', url: '/state', headers: { host: '127.0.0.1:1' }, async *[Symbol.asyncIterator]() {} }
  const res = { headersSent: false, writeHead() { this.headersSent = true }, end(b) { payload = String(b ?? '') } }
  await handler(req, res)
  const elapsed = Date.now() - started
  const parsed = JSON.parse(payload)
  ok('冷启动第一次 /state 直接命中磁盘种子（不等冷扫）', elapsed < 150 && parsed.sessions?.[0]?.title === '昨天那条会话', `${elapsed}ms`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  ok('种子返回后仍在后台刷新', listCalls >= 2, `listSessions ${listCalls} 次`)
}

// ---------------------------------------------------------------- 12. 「每 N 轮」是字面意思
{
  let titleCalls = 0
  const llm = {
    async *stream() {
      titleCalls += 1
      yield { type: 'text-delta', text: '[]' } // 模型每次都说「不用改」
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const events = [{ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '看看这个报错' }], source: { kind: 'user' } } }]
  const sessionQuery = {
    listSessions: async () => [{ header: { id: 'sT', createdAt: 1, cwd: '/tmp' }, live: false }],
    readTitleSnapshots: async (ids) => ids.map((sessionId) => ({ status: 'fulfilled', sessionId, value: { title: { title: '看看这个报错' } } })),
    readTitleSnapshot: async () => ({ title: { title: '看看这个报错', source: { kind: 'generated' } } }),
    listEvents: async () => events,
    readEvent: async () => ({ target: { data: events[0].data } }),
    readSurface: async () => ({ events }),
  }
  let listener = null
  const routes = new Map()
  const ctx = {
    effect(fn) { const r = fn(); return typeof r === 'function' ? r : () => {} },
    on(name, fn) { if (name === 'session/event') listener = fn; return () => {} },
    get(name) { return name === 'sessionQuery' ? sessionQuery : name === 'llm' ? llm : undefined },
    webServer: { register(d) { routes.set(d.path, d.handler); return () => {} } },
    logger: { info() {}, warn() {} },
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-title-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'storages', 'dsh-session-categories'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'dsh-session-categories', 'state.json'),
    JSON.stringify({
      categories: [{ id: 'c1', name: '工作', color: '#000', order: 0, createdAt: 1, archived: false }],
      assignments: { sT: 'c1' }, // 已归类 → 只跑标题判断
      settings: { autoClassify: true, turnCount: 1, titleCheckEvery: 1 },
    }),
  )
  mod.apply(ctx, { provider: 'p', model: 'm' })
  const turnEnd = (turn) => listener({ id: 'sT', header: {} }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  turnEnd(1)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const afterFirst = titleCalls
  turnEnd(2)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  ok('「每 1 轮」= 每轮都检查（不再偷偷退避）', afterFirst === 1 && titleCalls === 2, `第1轮后 ${afterFirst} 次 / 第2轮后 ${titleCalls} 次`)
}

console.log('')
if (failed > 0) {
  console.error(`❌ ${failed} 项失败`)
  process.exit(1)
}
console.log('✅ Host 自检全部通过')
