/**
 * dsh-session-categories — Host 半。
 *
 * 职责：
 *  - 持久化「分类」「会话 → 分类」归属、待处理提示、忽略名单（$DSH_HOME/storages/dsh-session-categories/state.json）
 *  - 汇总会话清单（标题、工作区、时间）
 *  - 在分类下新建会话
 *  - AI 分类：手动批量建议 + 每轮对话结束后的单会话自动判断
 *
 * 对外接口都是 `/dsh-session-categories/api/*` 下的 HTTP 路由，Client 半只用 fetch。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const PLUGIN_ID = 'dsh-session-categories'
const API_ROOT = '/dsh-session-categories/api'
/**
 * 自动分类的节奏与上限。
 *
 * 模型对某些会话永远给不出结论（和所有分类都无关，返回 none 或置信度不够）——
 * 这种会话如果每轮都再问一次，就变成「没有任何提示、但一直在花钱」。
 * 所以：没结论就至少隔 CLASSIFY_RECHECK_TURNS 轮再问，连续 CLASSIFY_ATTEMPT_CAP 次没结论就停，
 * 等分类增删改（或用户手动判断）后再恢复。
 */
const CLASSIFY_RECHECK_TURNS = 3
const CLASSIFY_ATTEMPT_CAP = 5
/** 标题连续判断为「不用改」时的退避倍数上限：间隔按 1×2×4×8 递增，到顶就不再涨。 */
/** 调用日志最多留多少条（一条 = 一次模型调用）。给用户看「钱花在哪」，不做长账。 */
const CALL_LOG_LIMIT = 300

/** 分类色板：新建分类时按顺序轮换。 */
const PALETTE = [
  '#5b8def',
  '#e8833a',
  '#3fae7a',
  '#a46fe0',
  '#d95c8a',
  '#2fa8b5',
  '#c9a227',
  '#7a869a',
]

/**
 * Harness 用户目录。与 @deepseek-ai/dsh-home-paths 同规则：
 * 显式 DSH_HOME 优先，其次 ~/.dsh；空白字符串按未设置处理。
 */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req, limit = 1 << 20) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('请求体过大')
      error.status = 413
      error.code = 'body.tooLarge'
      throw error
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    // 客户端发坏了要报 400（“你发的不是 JSON”），不能报 500（“插件坏了”）
    const error = new Error('请求体不是合法的 JSON')
    error.status = 400
    error.code = 'body.invalidJson'
    throw error
  }
}

let idCounter = 0
function nextCategoryId() {
  idCounter = (idCounter + 1) % 0xffff
  return `cat_${Date.now().toString(36)}${idCounter.toString(36).padStart(3, '0')}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, min), max)
}

function truncate(text, max) {
  if (typeof text !== 'string') return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** 一次分类调用的累计量（次数 + token）。 */
function emptyUsage() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costCny: 0, lastAt: 0 }
}

/** 把一份 usage 合并进另一份（跨天汇总成「本周 / 本月」时用）。 */
function mergeUsage(target, source) {
  if (!source) return target
  target.calls += Number(source.calls) || 0
  target.inputTokens += Number(source.inputTokens) || 0
  target.outputTokens += Number(source.outputTokens) || 0
  target.costUsd += Number(source.costUsd) || 0
  target.costCny += Number(source.costCny) || 0
  target.lastAt = Math.max(target.lastAt || 0, Number(source.lastAt) || 0)
  return target
}

/** 本地时区的日期键 YYYY-MM-DD：花费档位按用户本地的日历算。 */
function dayKey(at = Date.now()) {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 分桶只留最近 N 天，够覆盖「本月」，又不会让 state.json 无限长。 */
const BUCKET_KEEP_DAYS = 100

/** 当日 / 本周（周一起算）/ 本月 三个档位的累计。 */
function periodUsage(usage, at = Date.now()) {
  const now = new Date(at)
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekStart = new Date(startOfDay)
  weekStart.setDate(weekStart.getDate() - ((now.getDay() + 6) % 7))
  const startOfWeek = weekStart.getTime()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const result = {
    day: { auto: emptyUsage(), manual: emptyUsage() },
    week: { auto: emptyUsage(), manual: emptyUsage() },
    month: { auto: emptyUsage(), manual: emptyUsage() },
  }
  for (const [key, row] of Object.entries(usage?.buckets ?? {})) {
    const [year, month, day] = key.split('-').map(Number)
    if (!year || !month || !day) continue
    const start = new Date(year, month - 1, day).getTime()
    for (const range of ['day', 'week', 'month']) {
      const from = range === 'day' ? startOfDay : range === 'week' ? startOfWeek : startOfMonth
      if (start < from) continue
      mergeUsage(result[range].auto, row?.auto)
      mergeUsage(result[range].manual, row?.manual)
    }
  }
  return result
}

/** 设置项的默认值：配置里给的是初始值，面板里改过的以 state.json 为准。 */
function normalizeSettings(raw, defaults) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const range = ['day', 'week', 'month'].includes(value.costRange) ? value.costRange : defaults.costRange
  return {
    autoClassify: value.autoClassify !== false,
    // 「新建会话落在哪个工作区」是用户的长期偏好，落盘保留
    newSessionWorkspaceId: typeof value.newSessionWorkspaceId === 'string' ? value.newSessionWorkspaceId : '',
    // 会话行首的分类标记：有些用户会把它看成「有新回复」的小圆点，允许关掉
    showRowMark: value.showRowMark !== false,
    costRange: range,
    // 判断轮数：取最近 N 轮用户消息（0 = 全部）。老配置里的 dataScope 折算过来
    turnCount:
      value.turnCount === 0 || value.turnCount === 'all'
        ? 0
        : Math.round(clampNumber(value.turnCount, 1, 20, value.dataScope === 'session' ? 0 : 1)),
    // 每隔几轮检查一次标题（0 = 关闭）。1 = 每轮都检查
    // 默认 3 轮看一次：设成 1（每轮都看）会让每轮都多一次模型调用，默认值别这么激进
    titleCheckEvery: Math.round(clampNumber(value.titleCheckEvery, 0, 100, 3)),
    minConfidence: clampNumber(value.minConfidence, 0, 1, defaults.minConfidence),
    // 侧边栏筛选清单里分类的顺序：created = 创建顺序（位置稳定，点开不会跳），
    // activity = 该分类下最新会话的活跃时间倒序。默认保持创建顺序，跟以前一样。
    filterSort: ['activity', 'created'].includes(value.filterSort) ? value.filterSort : 'created',
  }
}

/** 把磁盘上的任意内容收敛成可信结构：缺字段补默认，脏数据直接丢。 */
function normalizeState(raw, seedCategories, defaults) {
  const state = {
    version: 1,
    categories: [],
    assignments: {},
    hints: {},
    ignored: {},
    titleHints: {},
    titleIgnored: {},
    titleChecked: {},
    // 自动分类的尝试记录：{ turn, attempts }，attempts 是连续「没结论」的次数
    classifyChecked: {},
    // 每次模型调用的明细（新的在前），用于「钱花在哪」
    calls: [],
    settings: { autoClassify: true, newSessionWorkspaceId: '' },
    usage: { auto: emptyUsage(), manual: emptyUsage(), buckets: {} },
  }

  const seen = new Set()
  const categories = Array.isArray(raw?.categories) ? raw.categories : []
  for (const item of categories) {
    if (!item || typeof item !== 'object') continue
    const id = isNonEmptyString(item.id) ? item.id : nextCategoryId()
    if (seen.has(id)) continue
    seen.add(id)
    state.categories.push({
      id,
      name: isNonEmptyString(item.name) ? item.name.trim().slice(0, 60) : '未命名分类',
      color: isNonEmptyString(item.color)
        ? item.color
        : PALETTE[state.categories.length % PALETTE.length],
      order: Number.isFinite(item.order) ? item.order : state.categories.length,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      archived: item.archived === true,
    })
  }
  state.categories.sort((a, b) => a.order - b.order)

  const known = new Set(state.categories.map((c) => c.id))
  const assignments = raw && typeof raw.assignments === 'object' && raw.assignments !== null ? raw.assignments : {}
  for (const [sessionId, categoryId] of Object.entries(assignments)) {
    if (!isNonEmptyString(sessionId) || !isNonEmptyString(categoryId)) continue
    if (!known.has(categoryId)) continue
    state.assignments[sessionId] = categoryId
  }

  const hints = raw && typeof raw.hints === 'object' && raw.hints !== null ? raw.hints : {}
  for (const [sessionId, hint] of Object.entries(hints)) {
    if (!isNonEmptyString(sessionId) || !hint || typeof hint !== 'object') continue
    // 兼容旧格式（单条 categoryId）与新的多候选结构
    const rawCandidates = Array.isArray(hint.candidates)
      ? hint.candidates
      : isNonEmptyString(hint.categoryId)
        ? [{ categoryId: hint.categoryId, confidence: hint.confidence, at: hint.at }]
        : []
    const candidates = []
    for (const item of rawCandidates) {
      const categoryId = String(item?.categoryId ?? '')
      if (!known.has(categoryId)) continue
      if (candidates.some((c) => c.categoryId === categoryId)) continue
      candidates.push({
        categoryId,
        confidence: clampNumber(item?.confidence, 0, 1, 0.6),
        at: Number.isFinite(item?.at) ? item.at : Date.now(),
      })
    }
    if (candidates.length === 0) continue
    state.hints[sessionId] = {
      candidates: candidates.slice(0, 4),
      updatedAt: Number.isFinite(hint.updatedAt) ? hint.updatedAt : Date.now(),
    }
  }

  const ignored = raw && typeof raw.ignored === 'object' && raw.ignored !== null ? raw.ignored : {}
  for (const [sessionId, at] of Object.entries(ignored)) {
    if (!isNonEmptyString(sessionId)) continue
    state.ignored[sessionId] = Number.isFinite(at) ? at : Date.now()
  }

  const titleHints = raw && typeof raw.titleHints === 'object' && raw.titleHints !== null ? raw.titleHints : {}
  for (const [sessionId, hint] of Object.entries(titleHints)) {
    if (!isNonEmptyString(sessionId) || !isNonEmptyString(hint?.title)) continue
    state.titleHints[sessionId] = {
      title: hint.title.trim().slice(0, 60),
      at: Number.isFinite(hint.at) ? hint.at : Date.now(),
    }
  }

  const titleIgnored =
    raw && typeof raw.titleIgnored === 'object' && raw.titleIgnored !== null ? raw.titleIgnored : {}
  for (const [sessionId, at] of Object.entries(titleIgnored)) {
    if (!isNonEmptyString(sessionId)) continue
    state.titleIgnored[sessionId] = Number.isFinite(at) ? at : Date.now()
  }

  const titleChecked =
    raw && typeof raw.titleChecked === 'object' && raw.titleChecked !== null ? raw.titleChecked : {}
  for (const [sessionId, turn] of Object.entries(titleChecked)) {
    if (!isNonEmptyString(sessionId)) continue
    state.titleChecked[sessionId] = Math.round(clampNumber(turn, 0, 1e6, 0))
  }

  const classifyChecked =
    raw && typeof raw.classifyChecked === 'object' && raw.classifyChecked !== null
      ? raw.classifyChecked
      : {}
  for (const [sessionId, value] of Object.entries(classifyChecked)) {
    if (!isNonEmptyString(sessionId) || !value || typeof value !== 'object') continue
    state.classifyChecked[sessionId] = {
      turn: Math.round(clampNumber(value.turn, 0, 1e6, 0)),
      attempts: Math.round(clampNumber(value.attempts, 0, 100, 0)),
    }
  }


  const calls = Array.isArray(raw?.calls) ? raw.calls : []
  for (const item of calls) {
    if (!item || typeof item !== 'object') continue
    if (state.calls.length >= CALL_LOG_LIMIT) break
    state.calls.push({
      at: Number.isFinite(item.at) ? item.at : Date.now(),
      sessionId: isNonEmptyString(item.sessionId) ? item.sessionId : '',
      title: isNonEmptyString(item.title) ? item.title.slice(0, 120) : '',
      mode: item.mode === 'manual' ? 'manual' : 'auto',
      scope: ['classify', 'title', 'both'].includes(item.scope) ? item.scope : 'classify',
      reason: isNonEmptyString(item.reason) ? item.reason.slice(0, 40) : '',
      outcome: ['suggested', 'none', 'error'].includes(item.outcome) ? item.outcome : 'none',
      inputTokens: Number.isFinite(item.inputTokens) ? item.inputTokens : 0,
      outputTokens: Number.isFinite(item.outputTokens) ? item.outputTokens : 0,
      costCny: Number.isFinite(item.costCny) ? item.costCny : 0,
    })
  }

  state.settings = normalizeSettings(raw?.settings, defaults)

  for (const bucket of ['auto', 'manual']) {
    const value = raw?.usage?.[bucket]
    if (!value || typeof value !== 'object') continue
    state.usage[bucket] = {
      calls: Number.isFinite(value.calls) ? value.calls : 0,
      inputTokens: Number.isFinite(value.inputTokens) ? value.inputTokens : 0,
      outputTokens: Number.isFinite(value.outputTokens) ? value.outputTokens : 0,
      costUsd: Number.isFinite(value.costUsd) ? value.costUsd : 0,
      costCny: Number.isFinite(value.costCny) ? value.costCny : 0,
      lastAt: Number.isFinite(value.lastAt) ? value.lastAt : 0,
    }
  }

  // 按天分桶：当日 / 本周 / 本月三个档位都从它汇总，只留最近 100 天。
  const cutoff = dayKey(Date.now() - BUCKET_KEEP_DAYS * 86400000)
  const buckets = raw?.usage?.buckets
  if (buckets && typeof buckets === 'object') {
    for (const [key, row] of Object.entries(buckets)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff) continue
      if (!row || typeof row !== 'object') continue
      state.usage.buckets[key] = {
        auto: { ...emptyUsage(), ...(row.auto ?? {}) },
        manual: { ...emptyUsage(), ...(row.manual ?? {}) },
      }
    }
  }

  // 只有「文件不存在」（raw === null）才算首次运行，才写 seedCategories。
  // 不能用 categories.length === 0 判断：用户主动把分类删空之后，下一次写操作
  // 会重新走 load()，那些分类就会被「复活」。
  if (raw === null && Array.isArray(seedCategories)) {
    seedCategories
      .filter(isNonEmptyString)
      .map((name) => name.trim())
      .filter((name, index, list) => list.indexOf(name) === index)
      .forEach((name, index) => {
        state.categories.push({
          id: nextCategoryId(),
          name: name.slice(0, 60),
          color: PALETTE[index % PALETTE.length],
          order: index,
          createdAt: Date.now(),
          archived: false,
        })
      })
  }
  return state
}

/**
 * 分类状态存储。
 *
 * 写操作串行化（tail 链），避免两个面板动作同时读改写互相覆盖；
 * 落盘用 tmp + rename，进程中途被杀也不会留下半个 JSON。
 */
class CategoryStore {
  constructor(path, seedCategories, defaults) {
    this.path = path
    this.seedCategories = seedCategories
    this.defaults = defaults
    this.state = normalizeState(null, seedCategories, defaults)
    this.ready = null
    this.tail = Promise.resolve()
  }

  load() {
    if (this.ready) return this.ready
    this.ready = (async () => {
      try {
        const raw = await readFile(this.path, 'utf8')
        this.state = normalizeState(JSON.parse(raw), this.seedCategories, this.defaults)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          // 真的没有文件 = 首次运行
          this.state = normalizeState(null, this.seedCategories, this.defaults)
          await this.persistQuiet()
        } else {
          // 文件坏了（断电、手改错、磁盘写满）：备份一份、按默认状态继续。
          // 绝不能把失败缓存进 this.ready —— 那样一次损坏会让插件永久 500，
          // 连用户手动修好文件都不恢复。
          const backup = `${this.path}.bad-${Date.now()}`
          try {
            await rename(this.path, backup)
          } catch {
            /* 备份失败也要往下走：至少内存里是可用状态 */
          }
          this.state = normalizeState(null, this.seedCategories, this.defaults)
          await this.persistQuiet()
          this.lastError = error
          this.lastBackup = backup
        }
      }
      return this.state
    })()
    return this.ready
  }

  /** 落盘失败（磁盘满、只读）不能让读接口跟着挂：记一笔，内存里继续用。 */
  async persistQuiet() {
    try {
      await this.persist()
    } catch (error) {
      this.lastError = error
    }
  }

  async persist() {
    this.state.version = 1
    const body = JSON.stringify(this.state, null, 2)
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, this.path)
  }

  mutate(fn) {
    const run = this.tail.then(async () => {
      await this.load()
      const result = await fn(this.state)
      await this.persist()
      return result
    })
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  snapshot() {
    return {
      version: this.state.version,
      categories: this.state.categories.map((c) => ({ ...c })),
      assignments: { ...this.state.assignments },
      hints: Object.fromEntries(Object.entries(this.state.hints).map(([k, v]) => [k, { ...v }])),
      ignored: { ...this.state.ignored },
      titleHints: Object.fromEntries(
        Object.entries(this.state.titleHints).map(([k, v]) => [k, { ...v }]),
      ),
      titleIgnored: { ...this.state.titleIgnored },
      settings: { ...this.state.settings },
      usage: {
        auto: { ...this.state.usage.auto },
        manual: { ...this.state.usage.manual },
        // 客户端只要三个档位的汇总，不必把每天的分桶也发过去
        periods: periodUsage(this.state.usage),
      },
    }
  }
}

/** ContentBlock[] → 纯文本。 */
function contentText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join(' ').trim()
}

/** 会话里真正由人打出来的消息。注入的上下文事件都带 source.kind，一律排除。 */
function isHumanMessage(event) {
  const kind = event?.data?.source?.kind
  if (kind === undefined || kind === null) return true
  return kind === 'user'
}

/**
 * 判断标题时给模型的对话片段。
 *
 * 标题要能让人一个月后找回这条会话，所以必须看「整条会话想干什么」：
 * 只取最后一轮（「执行完成，检查一下」这种）根本看不出业务。
 * 做法是首条 + 最近若干条用户消息 —— 首条通常就是这条会话的来意，
 * 最近几条反映它后来变成了什么。只取人打的字，且封顶条数，避免长会话把每轮都发一遍。
 */
const TITLE_DIGEST_TAIL = 20
function titleDigestTurns(turns) {
  if (turns.length <= TITLE_DIGEST_TAIL) return turns
  const tail = turns.slice(-TITLE_DIGEST_TAIL)
  const head = turns[0]
  return tail[0] === head ? tail : [head, ...tail]
}

/**
 * 一轮的摘要文本：用户说了什么 + 这一轮助手回了什么。
 *
 * 用户的话保持完整（那是诉求，最短也最关键）；助手回复动辄一两千字，
 * 只留「开头 300 字 + 结尾 200 字」—— 结果通常写在结尾，过程和表格不必全塞进标题判断。
 */
const REPLY_HEAD = 300
const REPLY_TAIL = 200
function clipReply(reply) {
  const text = String(reply ?? '')
  if (text.length <= REPLY_HEAD + REPLY_TAIL) return text
  return `${text.slice(0, REPLY_HEAD)} …（中间略）… ${text.slice(-REPLY_TAIL)}`
}
function formatTurn(turn, index) {
  const lines = [`${index + 1}. 用户：${turn.user}`]
  if (turn.reply) lines.push(`   助手：${clipReply(turn.reply)}`)
  return lines.join('\n')
}

/**
 * 素材的字符预算（粗算 1 字 ≈ 1 token，12k ≈ 12k token，给输出留足余量）。
 * 超过预算时**丢最早的部分**：判断「现在在干什么」看最近的最准。
 */
const MATERIAL_CHAR_BUDGET = 12000

/** 从最新往回装，装不下就停：返回被选中的那一截（保持原顺序）。 */
function takeNewestWithinBudget(items, budget, sizeOf) {
  const picked = []
  let used = 0
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const size = sizeOf(items[index])
    // 至少留一条：单条就超预算时也要给它（否则素材会是空的）
    if (picked.length > 0 && used + size > budget) break
    picked.unshift(items[index])
    used += size
  }
  return picked
}

/**
 * 汇总会话清单。
 *
 * 只保留「用户自己发起、且有内容」的会话：
 *  - 子代理 / fork / 委派产生的子会话（origin、parentSession、delegationDepth）
 *  - 空白会话（sessionController 的 blank 标记）
 * 标题优先用日志里的标题事件；没有标题的（早期会话、标题生成失败）退回首条用户消息，
 * 仍然取不到内容的按空白处理，不展示成「未命名会话」。
 */
async function collectSessions(ctx, timings) {
  const mark = (name, startedAt) => {
    if (timings) timings[name] = Date.now() - startedAt
  }
  const stage0 = Date.now()
  const sessionQuery = ctx.get('sessionQuery')
  if (!sessionQuery) {
    const error = new Error('sessionQuery 服务不可用，无法列出会话')
    error.status = 503
    throw error
  }
  const registry = ctx.get('workspaceRegistry')
  const controller = ctx.get('sessionController')

  const blankIds = new Set()
  // 会话的「最后活动时间」在 controller 的摘要里（updatedAt），
  // sessionQuery 的记录只有 createdAt —— 排序要按活动时间，所以顺手把它取出来。
  const updatedAtOf = new Map()
  if (controller?.list) {
    const controllerStart = Date.now()
    try {
      const value = await controller.list({}, new AbortController().signal)
      for (const item of value?.items ?? []) {
        if (item.blank) blankIds.add(item.sessionId)
        if (Number.isFinite(item.updatedAt)) updatedAtOf.set(item.sessionId, item.updatedAt)
      }
    } catch (error) {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] 读取会话摘要失败：${error?.message ?? error}`)
    }
    mark('controllerList', controllerStart)
  }

  // 子会话（子代理、fork/委派产生的会话）不进分类面板，也不计入统计：
  // 它们是某个根会话的衍生物，归类应该发生在根会话上。
  const listStart = Date.now()
  const allRecords = await sessionQuery.listSessions()
  mark('listSessions', listStart)
  const records = allRecords.filter(
    (record) =>
      record?.header &&
      record.header.origin !== 'subagent' &&
      record.header.parentSession === undefined &&
      !(Number(record.header.delegationDepth) > 0) &&
      !blankIds.has(record.header.id),
  )
  const ids = records.map((record) => record.header.id)

  const titleStart = Date.now()
  const titles = new Map()
  if (ids.length > 0) {
    try {
      const observations = await sessionQuery.readTitleSnapshots(ids)
      for (const item of observations) {
        if (item.status !== 'fulfilled') continue
        const title = item.value?.title?.title
        if (typeof title === 'string' && title.trim() !== '') titles.set(item.sessionId, title)
      }
    } catch (error) {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] 读取会话标题失败：${error?.message ?? error}`)
    }
  }

  mark('titles', titleStart)
  const workspaceStart = Date.now()
  const workspaceOf = new Map()
  if (registry) {
    try {
      for (const workspace of registry.list()) {
        for (const sessionId of workspace.sessionIds) {
          workspaceOf.set(sessionId, { id: workspace.id, title: workspace.title })
        }
      }
    } catch (error) {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] 读取工作区失败：${error?.message ?? error}`)
    }
  }

  mark('workspaces', workspaceStart)
  const fallbackStart = Date.now()
  // 没有标题的会话补一次首条消息，作为显示标题的兜底。
  // 限并发 6：之前是 Promise.all 全并发，一百条无标题会话会同时打出上百个读日志请求。
  const missing = records.filter((record) => !titles.has(record.header.id))
  if (missing.length > 0) {
    const fallbacks = await mapLimit(missing, 6, async (record) => {
      const text = await firstUserText(sessionQuery, record.header.id)
      return [record.header.id, text]
    })
    for (const [id, text] of fallbacks) {
      if (text) titles.set(id, truncate(text, 32))
    }
  }

  mark('firstUserText', fallbackStart)
  return records
    .map((record) => ({
      id: record.header.id,
      title: titles.get(record.header.id) ?? '',
      createdAt: record.header.createdAt,
      // 分类与分类内会话都按这个时间排序（原生列表用的也是它）
      updatedAt: updatedAtOf.get(record.header.id) ?? record.header.createdAt,
      cwd: record.header.cwd ?? '',
      live: Boolean(record.live),
      workspace: workspaceOf.get(record.header.id) ?? null,
    }))
    // 既没标题也没内容的会话不展示，避免一屏「未命名会话」
    .filter((session) => session.title !== '')
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

/** 取某个会话的首条**真人**用户消息（分类素材 / 没有标题时的兜底标题）。 */
async function firstUserText(sessionQuery, sessionId) {
  try {
    const events = await sessionQuery.listEvents(sessionId)
    // 必须按 isHumanMessage 过滤：否则第一条命中往往是工作区规则 / 运行时快照，
    // 兜底标题就会变成「Current runtime context…」这种对用户毫无意义的串。
    const first = events.find((event) => event.type === 'user/message' && isHumanMessage(event))
    if (!first) return ''
    const window = await sessionQuery.readEvent({ sessionId, seq: first.seq, before: 0, after: 0 })
    const data = window?.target?.data
    // 两种形状都要认：surface 事件正文在 data.content，原始日志里在 data.message.content
    return truncate(contentText(data?.message?.content) || contentText(data?.content), 400)
  } catch {
    return ''
  }
}

/** 限并发跑一批异步任务：无标题会话可能上百条，Promise.all 全并发会把宿主 I/O 打成尖峰。 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * 自动分类用的素材定义。
 *
 * 模板里没写 {conversation} / {latestExchange} 这类字段时，连会话表面都不读，
 * 只按标题判断；写了才读一次 readSurface。
 */
const DEFAULT_MATERIAL_TEMPLATE =
  '- 会话 id={sessionId} | 标题：{title} | 对话：{conversation}{priorLine}'

/** 模板里出现的占位符（去重）。 */
function templateTokens(template) {
  const tokens = new Set()
  const pattern = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
  let match
  while ((match = pattern.exec(String(template))) !== null) tokens.add(match[1])
  return tokens
}

/** 单遍替换 {token}；模板里不认识的占位符原样留着，方便用户发现拼错。 */
function renderTemplate(template, values) {
  return String(template).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, token) =>
    Object.prototype.hasOwnProperty.call(values, token) ? String(values[token] ?? '') : whole,
  )
}

/**
 * 自动分类用的会话素材。
 *
 * 只取「用户说的话」和「助手最后的回复」：思考过程（reasoning）和工具调用/结果
 * 全部不计入 —— 它们对「这条会话属于哪一类」几乎没有信息量，却最占 token。
 *
 * 内容不做截断：
 *   单轮   = 最近一条用户消息 + 助手最后一条回复
 *   整个会话 = 所有用户消息（按顺序） + 助手最后一条回复
 * 判断标题时换一套口径：给「逐轮的请求 + 该轮回复」（首轮 + 最近 20 轮），
 * 因为标题要让人日后找回会话，只看最后一轮（「执行完成，检查一下」）看不出业务。
 * 注入的上下文消息（工作区规则、运行时快照、时间戳、子任务完成通知）不算用户说的话，全部剔除。
 * 默认只给标题 + 对话，模板里没用到就不去读会话表面。
 */
async function buildSessionMaterial(sessionQuery, sessionId, options = {}) {
  const tokens = templateTokens(DEFAULT_MATERIAL_TEMPLATE)
  // 0 = 全部；N = 最近 N 轮用户消息
  const turnLimit = options.turnCount === 0 ? 0 : Math.max(1, Math.round(Number(options.turnCount) || 1))
  const material = {
    sessionId,
    title: options.title ?? '',
    workspace: options.workspace ?? '',
    firstMessage: '',
    lastMessage: '',
    lastReply: '',
    latestExchange: '',
    transcript: '',
    conversation: '',
  }

  const needsSurface = [
    'conversation',
    'transcript',
    'latestExchange',
    'lastReply',
    'lastMessage',
    'firstMessage',
  ].some((token) => tokens.has(token))
  if (!needsSurface) return material

  try {
    const surface = await sessionQuery.readSurface(sessionId)
    // 按「轮」聚合：一条人打的用户消息开一轮，这一轮后续的助手文本算这一轮的回复
    const turnList = []
    let current = null
    for (const event of surface?.events ?? []) {
      if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
      // contentText 只取 text 块：reasoning / tool-call / tool-result 天然被排除。
      // readSurface 给的是 surface 事件，用户消息的正文在 data.content，
      // 助手消息在 data.message.content —— 两种都要认，否则素材会是空的。
      const text = contentText(event.data?.message?.content) || contentText(event.data?.content)
      if (!text) continue
      if (event.type === 'user/message') {
        // 注入的上下文（工作区规则、运行时快照、时间戳、子任务完成通知、回滚占位）
        // 不是用户说的话，混进素材里只会干扰判断
        if (!isHumanMessage(event)) continue
        if (current) turnList.push(current)
        current = { user: text, reply: '' }
      } else if (current) {
        // 同一轮里可能有多条助手文本（分步输出），取最后一条完整的
        current.reply = text
      }
    }
    if (current) turnList.push(current)

    const userTexts = turnList.map((turn) => turn.user)
    const replyTexts = turnList.map((turn) => turn.reply).filter(Boolean)

    const lastUser = userTexts[userTexts.length - 1] ?? ''
    const lastReply = replyTexts[replyTexts.length - 1] ?? ''
    material.firstMessage = userTexts[0] ?? ''
    material.lastMessage = lastUser
    material.lastReply = lastReply
    material.latestExchange = [lastUser ? `用户：${lastUser}` : '', lastReply ? `助手：${lastReply}` : '']
      .filter(Boolean)
      .join('\n')
    const forTitle = options.forTitle === true
    if (forTitle) {
      // 判断标题看的是「逐轮：用户请求 + 这一轮做成了什么」。
      // 只给最后一轮看不出业务（「执行完成，检查一下」），只给用户的话又看不出结果。
      // 与「判断依据」的轮数设置无关：标题要的是整条会话的脉络。
      const digest = titleDigestTurns(turnList)
      const pickedTurns = takeNewestWithinBudget(digest, MATERIAL_CHAR_BUDGET, (turn) =>
        formatTurn(turn, 0).length,
      )
      const dropped = digest.length - pickedTurns.length
      material.conversation = [
        dropped > 0 ? `（更早的 ${dropped} 轮已省略）` : '',
        pickedTurns.map((turn, index) => formatTurn(turn, index)).join('\n'),
      ]
        .filter(Boolean)
        .join('\n')
    } else {
      // 「对话轮次 = 全部」时以前是把所有用户消息全塞进去，会话一长 prompt 就会顶爆上下文，
      // 调用直接失败、钱白花。这里从最新往回装，装到字数预算为止，并在开头注明省略了多少轮。
      const candidates = turnLimit === 0 ? userTexts : userTexts.slice(-turnLimit)
      const reply = clipReply(lastReply)
      // 末尾那条回复也要算进预算，否则「用户消息刚好塞满」时整体还是会超
      const picked = takeNewestWithinBudget(
        candidates,
        MATERIAL_CHAR_BUDGET - reply.length,
        (text) => text.length + 8,
      )
      const dropped = candidates.length - picked.length
      material.lastReply = reply
      material.latestExchange = [lastUser ? `用户：${lastUser}` : '', reply ? `助手：${reply}` : '']
        .filter(Boolean)
        .join('\n')
      material.conversation = [
        dropped > 0 ? `（更早的 ${dropped} 轮已省略）` : '',
        picked.map((text) => `用户：${text}`).join('\n'),
        reply ? `助手：${reply}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }
    // 兼容老模板里的 {transcript}：语义与整个会话的对话相同
    material.transcript = material.conversation
  } catch (error) {
    // 单个会话读失败就退回标题判断，不让整批分类挂掉
    options.onError?.(error)
  }
  return material
}

/** AI 分类使用的 provider/model：显式配置优先，否则跟随运行时默认。 */
function resolveModel(ctx, config) {
  if (isNonEmptyString(config.provider) && isNonEmptyString(config.model)) {
    return { provider: config.provider.trim(), model: config.model.trim(), source: 'config' }
  }
  const picker = ctx.get('agentDefaultModel')
  try {
    const selection = picker?.currentSelection?.()
    if (selection && isNonEmptyString(selection.provider) && isNonEmptyString(selection.model)) {
      return { provider: selection.provider, model: selection.model, source: 'default' }
    }
  } catch {
    /* 默认模型服务尚未就绪时按不可用处理 */
  }
  return undefined
}

/** 从模型输出里抠出 JSON 数组：允许 ```json 包裹、前后有解释。 */
function parseSuggestionArray(text) {
  if (typeof text !== 'string') return []
  const start = text.indexOf('[')
  if (start === -1) return []
  const body = text.slice(start)
  const end = body.lastIndexOf(']')
  if (end !== -1) {
    try {
      const parsed = JSON.parse(body.slice(0, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* 落到下面的逐条容错 */
    }
  }
  // 输出被截断时，尽量把已经写完整的对象捞回来，不让整批作废
  const items = []
  const objectPattern = /\{[^{}]*\}/g
  let match
  while ((match = objectPattern.exec(body)) !== null) {
    try {
      items.push(JSON.parse(match[0]))
    } catch {
      /* 半个对象，跳过 */
    }
  }
  return items
}

const SYSTEM_PROMPT = [
  '你是会话归档助手，负责在对话进行中判断这条会话应该归入哪个分类。',
  '每次判断会给你这条会话的对话内容：可能只是最近一轮的请求和回复，也可能是整条会话，按你看到的内容判断。',
  '规则：',
  '1. 只针对给定的这一条会话给出结论，不要遗漏、不要跳过。',
  '2. 以给出的对话内容为准，不要凭空猜测没给你的上下文。',
  '3. 挑「最接近」的分类即可，不要求完美匹配；只有与该分类毫无关系时才算不合适。',
  '4. 如果这一轮的内容与所有分类都确实无关，把 categoryId 写成 "none"。',
  '5. confidence 取 0 到 1：0.85 以上非常确定，0.6~0.85 大致合适，0.6 以下勉强但仍是你的最佳选择。',
  '6. 另外看一眼这条会话现在的标题：标题是用户日后在列表里找回这条会话的唯一线索，必须同时写清「在弄什么东西」和「做了什么」（例如「修改班级教材费说明并出配置 SQL」「解释 buildSessionMaterial 的兜底逻辑」）。「东西」指内容里真实出现的具体对象（系统/模块/接口/文件/报错/配置/文档/概念都算），不要求是业务名词，也不要为了显得有业务含义而塞进没出现过的词；只有动作没对象的（「查看某会话」「生成SQL」「检查一下」「执行完成」）要额外给一个能直接搜到的 title；两样都写清了就不要给 title 字段。',
  '7. 只输出一个 JSON 数组，不要 Markdown 代码块，不要任何解释。',
  '数组元素形如：{"sessionId":"<会话id>","categoryId":"<分类id 或 none>","confidence":0.0,"title":"<可选的新标题>"}',
].join('\n')

/**
 * 只判断标题时用的系统提示词（分类已经定好了，不再重复问）。
 *
 * 标题的唯一用途是「日后找回来」：一个月后用户翻列表，只能看到标题。
 * 所以判断标准不是「标题和内容有没有关系」，而是「靠这个标题能不能想起这条会话在弄什么、做了什么」——
 * 只有动作、没有对象的标题（「生成SQL」「检查一下」）一律算不合格。
 * 「对象」是广义的：可以是业务系统，也可以是接口、文件、报错、配置、文档、概念，
 * 所以纯技术、纯问答的会话同样能判 —— 不能要求每一条会话都有业务信息。
 */
const TITLE_SYSTEM_PROMPT = [
  '你是会话标题助手。这条会话的标题只有一个用途：一个月后用户在会话列表里靠它找回当时的记录。',
  '你要读完给你的内容（当前标题 + 这条会话逐轮的请求与回复），判断这个标题「能不能让人想起这条会话到底在弄什么、做了什么」。',
  '规则：',
  '1. 合格的标题必须同时有两样东西，缺一样就要重起：',
  '   - 对象：这条会话在弄的那个「东西」。它可以是任何具体事物 —— 系统、模块、接口、文件、脚本、配置、数据表、页面、报错、日志、文档、需求、知识点、某个名词的解释……；不要求是业务名词，技术活、查资料、问概念都有自己的对象；',
  '   - 具体操作或结论：改了什么、新增了什么、查了什么、修了什么、问了什么、生成了什么、定位到什么原因。',
  '2. 只有同时具备这两样的标题才返回空数组 []，返回 [] 表示「不用改」——不要为了改而改。',
  '3. 下面这些只有动作、没有对象，一律不合格，必须给新标题：「查看X会话」「生成SQL」「修改数据」「改配置」「帮着看一下」「检查一下」「继续」「问题排查」「执行完成」「需求确认」「临时处理」。',
  '4. 「对象」必须是能直接搜到的具体名词，不能是空壳词：会话、对话、内容、数据、文件、脚本、配置、任务、问题 这类只说明「是个什么东西」、说不出具体是什么的，都不算对象。例如「查看某会话并生成SQL」仍然不合格 —— 要写清是哪条业务、哪个模块、哪个报错、哪张表。',
  '5. 标题已经过时、只是第一轮临时起的、或与后来的内容对不上，也要给新标题。',
  '6. 新标题写法：8~24 个字，一句话，主语可以省略；写进内容里真实出现过、最容易被搜到的名词（模块名、接口路径、报错原文、文件名、功能名、业务对象名都算）；不要引号、书名号、句号，不要出现「会话」「对话」「用户」二字。',
  '7. 只用内容里出现过的东西起标题，不要编造。尤其不要为了显得「有业务含义」而塞进没出现过的系统名、分校、班级、订单、商品这类词 —— 纯技术、纯问答的会话本来就没有业务信息，硬凑就是错的。',
  '8. 内容本来就很轻（只是问一个概念、确认一件事、看一眼某个报错）：把「问/看的到底是什么」写清楚就够了，不需要凑操作步骤，也不要去猜它背后的业务。',
  '9. 连对象都看不出来（纯寒暄、内容为空、只有一句「继续」但上文也没有信息）：返回 []，保持原标题，不要编。',
  '10. 只输出 JSON 数组，不要 Markdown 代码块，不要任何解释。',
  '',
  '示例（右边才合格，因为都能看出「在弄什么、做了什么」）：',
  '- 「查看workbuddy会话并生成SQL」→「修改班级三项费用说明文案并出配置SQL」',
  '- 「问题排查」→「UK 学员订阅订单缺失排查」',
  '- 「改一下配置」→「4402 分校教材费说明配置调整」',
  '- 「代码修改」→「会话分类插件加归档视图」',
  '- 「检查一下」→「核对班级与 SKU 对应关系」',
  '- 「这个报错是啥」→「本地启动报 ERR_MODULE_NOT_FOUND 的原因确认」',
  '- 「解释下这段」→「解释 buildSessionMaterial 的兜底逻辑」',
  '- 「继续」→「按设计稿补齐设置面板样式」',
  '',
  '形如：[{"sessionId":"<会话id>","title":"<新标题>"}]，不需要改时输出 []',
].join('\n')

async function classifyBatch(ctx, model, categories, sessions, options = {}) {
  // askCategory = false：这条会话已经归好类了，这次只问标题
  const askCategory = options.askCategory !== false
  const categoryLines = categories.map((c) => `- ${c.id} | ${c.name}`).join('\n')
  const template = DEFAULT_MATERIAL_TEMPLATE
  const sessionLines = sessions
    .map((session) => {
      const line = renderTemplate(template, {
        ...session.material,
        id: session.id,
        prior: session.prior ?? '',
        // 有旧判断时才追加这一句，没有就留空 —— 模板里写成 {priorLine} 不会留下空标签
        priorLine: session.prior
          ? ` 之前判断过：${session.prior}（如果这次结论不同，照你的判断给新的，不用迁就旧结论）`
          : '',
        categories: categoryLines,
        count: sessions.length,
      })
      return line
    })
    .join('\n')

  // 自定义系统提示词里也允许 {categories} / {count}；默认提示词不含占位符
  const system = renderTemplate(askCategory ? SYSTEM_PROMPT : TITLE_SYSTEM_PROMPT, {
    categories: categoryLines,
    count: sessions.length,
  })

  const prompt = askCategory
    ? [
        '可用分类（id | 名称）：',
        categoryLines,
        '',
        '待分类会话：',
        sessionLines,
        '',
        `以上共 ${sessions.length} 条会话，请逐条给出分类结果，输出 ${sessions.length} 个元素组成的 JSON 数组。`,
        '每条会话都要出现；与所有分类都无关的用 "none"。',
      ].join('\n')
    : [
        '待判断标题的会话：',
        sessionLines,
        '',
        '按上面的标准判断：当前标题只要缺「对象」或「具体操作」中的任何一样，就给出一个能让人日后搜得到的新标题；',
        '两样都写清了才输出 []。',
        '标题语言跟随会话本身的主要语言：会话是英文的，就给英文标题，不要翻译成中文。',
        '特别注意：对象不能是「会话 / 对话 / 内容 / 数据 / 文件 / 脚本 / 配置 / 任务 / 问题」这类空壳词，',
        '像「查看某会话并生成SQL」「查看报错信息」这样把空壳词当对象的，一律不合格。',
      ].join('\n')

  const llm = ctx.get('llm')
  if (!llm) throw new Error('llm 服务不可用')

  let text = ''
  const usage = { calls: 1, inputTokens: 0, outputTokens: 0 }
  const stream = llm.stream({
    provider: model.provider,
    model: model.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    temperature: 0,
    maxTokens: 3000,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'usage' && chunk.usage) {
      usage.inputTokens += chunk.usage.inputTokens ?? 0
      usage.outputTokens += chunk.usage.outputTokens ?? 0
    }
    if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? '模型调用失败')
    }
  }
  return { items: parseSuggestionArray(text), usage }
}

/** 把一次调用的 token 量累加到对应桶（auto / manual）。 */
function addUsage(target, usage) {
  if (!usage) return
  target.calls += usage.calls ?? 1
  target.inputTokens += usage.inputTokens ?? 0
  target.outputTokens += usage.outputTokens ?? 0
  target.costUsd = (target.costUsd ?? 0) + (usage.costUsd ?? 0)
  target.costCny = (target.costCny ?? 0) + (usage.costCny ?? 0)
  target.lastAt = Date.now()
}

/**
 * 记一条调用明细（新的在前，最多 CALL_LOG_LIMIT 条）。
 * 目的只有一个：用户能看见「这次钱花在哪个会话、判断什么、有没有结果」。
 */
function recordCall(state, entry) {
  const list = state.calls ?? (state.calls = [])
  list.unshift({
    at: Date.now(),
    sessionId: String(entry.sessionId ?? ''),
    title: String(entry.title ?? '').slice(0, 120),
    mode: entry.mode === 'manual' ? 'manual' : 'auto',
    scope: ['classify', 'title', 'both'].includes(entry.scope) ? entry.scope : 'classify',
    reason: String(entry.reason ?? '').slice(0, 40),
    outcome: ['suggested', 'none', 'error'].includes(entry.outcome) ? entry.outcome : 'none',
    inputTokens: Math.round(Number(entry.inputTokens) || 0),
    outputTokens: Math.round(Number(entry.outputTokens) || 0),
    costCny: Number(entry.costCny) || 0,
  })
  if (list.length > CALL_LOG_LIMIT) list.length = CALL_LOG_LIMIT
}

/** 累加总账，同时记一笔到「今天」的分桶（当日/本周/本月都从分桶汇总）。 */
function recordUsage(state, bucket, usage) {
  if (!usage) return
  addUsage(state.usage[bucket], usage)
  const buckets = state.usage.buckets ?? (state.usage.buckets = {})
  const key = dayKey()
  const row = buckets[key] ?? (buckets[key] = { auto: emptyUsage(), manual: emptyUsage() })
  addUsage(row[bucket], usage)
}

/**
 * 从 dsh-cost-meter 的价格目录里取单价，按 token 估算一次调用的费用。
 *
 * 价格表在该插件的 `costMeter.getState().config.prices` 里，数值是
 * 美元 / 1M tokens（`cacheMiss` 对应输入、`output` 对应输出），
 * 人民币金额用它的 `exchangeRate` 换算，和它的账本口径一致。
 * 取不到价格（没装 cost-meter、或模型不在目录里）就只统计 token，不猜。
 */
function priceEntry(prices, provider, model) {
  if (!prices) return null
  const models = prices.models ?? {}
  return models[model] ?? models[`${provider}:${model}`] ?? models[`${provider}/${model}`] ?? prices.default ?? null
}

function estimateCost(prices, provider, model, usage) {
  const entry = priceEntry(prices, provider, model)
  if (!entry || entry.unpriced === true) return { costUsd: 0, costCny: 0 }
  const inputRate = typeof entry.cacheMiss === 'number' ? entry.cacheMiss : entry.input
  const outputRate = typeof entry.output === 'number' ? entry.output : 0
  if (typeof inputRate !== 'number' || !Number.isFinite(inputRate)) return { costUsd: 0, costCny: 0 }
  const costUsd = (usage.inputTokens / 1e6) * inputRate + (usage.outputTokens / 1e6) * outputRate
  const rate = Number(prices.exchangeRate)
  const costCny = Number.isFinite(rate) && rate > 0 ? costUsd * rate : costUsd
  return { costUsd, costCny }
}

/** 校验模型返回：只保留候选会话 × 已知分类，并按置信度过滤、去重。 */
function sanitizeSuggestions(raw, candidates, categories, minConfidence) {
  const candidateIds = new Set(candidates.map((s) => s.id))
  const categoryIds = new Set(categories.map((c) => c.id))
  const seen = new Set()
  const suggestions = []
  for (const item of raw) {
    const sessionId = String(item?.sessionId ?? '')
    const categoryId = String(item?.categoryId ?? '').trim()
    if (!candidateIds.has(sessionId)) continue
    // 模型明确判定「与所有分类无关」时丢弃这条
    if (categoryId === '' || categoryId === 'none' || categoryId === 'null') continue
    if (!categoryIds.has(categoryId)) continue
    const score = clampNumber(item?.confidence, 0, 1, 0.6)
    if (score < minConfidence) continue
    if (seen.has(sessionId)) continue
    seen.add(sessionId)
    suggestions.push({ sessionId, categoryId, confidence: score })
  }
  return suggestions
}

/** 校验模型给的新标题：非空、和旧的不同、去掉包裹的引号、限长。 */
function sanitizeTitle(raw, sessionId, currentTitle) {
  for (const item of raw) {
    if (String(item?.sessionId ?? '') !== sessionId) continue
    const rawTitle = typeof item?.title === 'string' ? item.title : ''
    const clean = rawTitle
      .trim()
      .replace(/^[\s"'“”「」《》]+/, '')
      .replace(/[\s"'“”「」《》。]+$/, '')
      .replace(/\s+/g, ' ')
      .slice(0, 40)
    if (clean.length < 2) continue
    if (clean === (currentTitle ?? '').trim()) continue
    return clean
  }
  return ''
}

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  // provider/model 只来自配置（面板里不开放，避免把错的模型写死在用户数据里）
  const settings = {
    provider: typeof config.provider === 'string' ? config.provider : '',
    model: typeof config.model === 'string' ? config.model : '',
  }
  const seedCategories = Array.isArray(config.seedCategories) ? config.seedCategories : []
  // 其余可调项都存在 state.json 里，配置只在第一次运行时当前默认值
  const defaults = {
    minConfidence: clampNumber(config.minConfidence, 0, 1, 0.35),
    costRange: ['day', 'week', 'month'].includes(config.costRange) ? config.costRange : 'day',
  }

  const storePath = join(resolveDshHome(), 'storages', PLUGIN_ID, 'state.json')
  const store = new CategoryStore(storePath, seedCategories, defaults)
  const disposers = []

  /**
   * 写接口的来源校验。
   *
   * 这个插件的接口能删分类、改归属，还能花钱调模型（`/title`、`/rejudge`）。
   * 页面本身没有鉴权（本地 127.0.0.1），所以必须自己挡跨站请求：
   *
   *  - 浏览器跨站发 POST **一定会带 Origin**（form、sendBeacon、text/plain fetch 都带），
   *    所以「Origin 存在且与 Host 不一致」就拒掉 —— 这是唯一挡得住无 preflight 请求的判据；
   *  - 再要求 `Content-Type: application/json`：简单请求发不出这个头（会被升级成 preflight，
   *    而我们不返回 CORS 头，preflight 必然失败）；
   *  - 没有 Origin 的请求（curl、脚本）放行：它不是浏览器，不存在「用户被冒充」这一层。
   */
  const hostOf = (value) => {
    try {
      return new URL(String(value)).host
    } catch {
      return ''
    }
  }
  /** 只接受本机回环：DSH Web 是本地应用，用域名访问的都是别的页面。 */
  const isLoopbackHost = (host) => {
    const name = String(host ?? '').toLowerCase().replace(/^\[|\](:\d+)?$/g, '').replace(/:\d+$/, '')
    return name === 'localhost' || name === '::1' || name === '0:0:0:0:0:0:0:1' || /^127\.\d+\.\d+\.\d+$/.test(name)
  }
  /**
   * 请求来源校验。
   *
   * 只比 Origin 和 Host 是不够的：**DNS rebinding** 可以让攻击者的域名解析到 127.0.0.1，
   * 这时浏览器发来的 `Host` 和 `Origin` 都是 `evil.example`，两者当然相等 —— 校验形同虚设，
   * 攻击页面就能读到 `/state` 里的会话标题、删分类、甚至花我们的钱调模型。
   *
   * 真正的边界是「这次请求打的是不是本机」：Host 必须是回环地址。
   * 这一步对 GET 也要做（读接口同样泄露数据）。
   */
  const checkHost = (req, res) => {
    const host = String(req.headers?.host ?? '')
    if (host === '' || isLoopbackHost(host)) return true
    sendJson(res, 403, { error: '只接受本机访问（Host 必须是 localhost / 127.0.0.1）', code: 'host.notLoopback' })
    return false
  }
  const checkWrite = (req, res) => {
    const origin = req.headers?.origin
    const host = String(req.headers?.host ?? '')
    if (origin !== undefined && hostOf(origin) !== host) {
      sendJson(res, 403, { error: '跨站请求被拒绝', code: 'host.crossOrigin' })
      return false
    }
    const type = String(req.headers?.['content-type'] ?? '').toLowerCase()
    if (!type.includes('application/json')) {
      sendJson(res, 415, { error: '请求需要 Content-Type: application/json', code: 'host.contentType' })
      return false
    }
    return true
  }

  /** 统一请求包装：异常落成 500 + 可读消息，不让面板卡在 loading。 */
  const route = (path, handler) => {
    disposers.push(
      ctx.effect(() =>
        ctx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            try {
              // Host 必须是本机（挡 DNS rebinding），读写都要查
              if (!checkHost(req, res)) return
              if (req.method !== 'GET' && !checkWrite(req, res)) return
              await handler(req, res)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              ctx.logger?.warn?.(`[${PLUGIN_ID}] ${req.method} ${path} 失败：${message}`)
              // 请求体超限是客户端问题，不能报 500（会误导排查方向）
              const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500
              // 带上错误码：客户端据此翻译（英文界面不该弹中文报错）
              const code = typeof error?.code === 'string' ? error.code : ''
              if (!res.headersSent) sendJson(res, status, code ? { error: message, code } : { error: message })
              else res.end()
            }
          },
        }),
      ),
    )
  }

  const aiState = () => {
    const model = resolveModel(ctx, settings)
    return {
      available: Boolean(model && ctx.get('llm')),
      provider: model?.provider ?? '',
      model: model?.model ?? '',
      source: model?.source ?? '',
    }
  }

  /**
   * cost-meter 的价格目录缓存。
   * `getState()` 会构建完整账单状态，代价不小，所以取一次缓存 10 分钟。
   * 没有 cost-meter 或取不到时返回 null —— 调用方退化成只统计 token。
   */
  let pricingCache = { at: 0, value: null }
  const loadPricing = async () => {
    const now = Date.now()
    if (pricingCache.value && now - pricingCache.at < 600000) return pricingCache.value
    const meter = ctx.get('costMeter')
    if (!meter?.getState) return null
    try {
      const state = await meter.getState()
      const config = state?.config
      const prices = config?.prices
      if (!prices?.models) return null
      pricingCache = {
        at: now,
        value: {
          models: prices.models,
          default: prices.default,
          exchangeRate: Number(config.exchangeRate) || 0,
        },
      }
      return pricingCache.value
    } catch (error) {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] 读取 cost-meter 价格失败：${error?.message ?? error}`)
      return null
    }
  }

  const requirePost = (req, res) => {
    if (req.method === 'POST') return true
    sendJson(res, 405, { error: '只支持 POST', code: 'method.postOnly' })
    return false
  }

  // ---------------------------------------------------------------- 读状态

  /**
   * 会话清单缓存。
   *
   * 折叠全部会话标题要逐条读日志（近百条时 1~2 秒），而分类增删改根本不改变
   * 会话清单 —— 每次操作后整份重拉会让「删除分类」这类动作卡两秒。
   * 这里做 5 秒短缓存，新建会话时主动失效。
   */
  let sessionsCache = null
  let sessionsRefresh = null
  const SESSION_CACHE_MS = 5000

  /**
   * 会话清单的磁盘种子。
   *
   * 进程刚起来时内存里什么都没有，第一次打开面板要冷扫 1.7 秒。
   * 把上一次的结果落一份到磁盘（同目录、随插件状态一起），启动时先读回来：
   * 第一次 /state 就能立刻返回上次的清单，真正的刷新在后台做（和内存版同一套 SWR）。
   * 只在清单非空且超过一分钟才写盘，避免频繁 I/O 和「空列表覆盖好数据」。
   */
  const sessionsCachePath = join(dirname(storePath), 'sessions-cache.json')
  const SESSIONS_DISK_MIN_INTERVAL_MS = 60 * 1000
  let sessionsDiskAt = 0
  let sessionsDiskLoading = null

  const loadSessionsFromDisk = () => {
    if (sessionsDiskLoading) return sessionsDiskLoading
    sessionsDiskLoading = (async () => {
      if (sessionsCache) return
      try {
        const raw = await readFile(sessionsCachePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed?.sessions) || parsed.sessions.length === 0) return
        sessionsCache = { at: Number(parsed.at) || 0, value: parsed.sessions }
      } catch {
        /* 没有种子文件 / 文件坏了都不影响功能，只是第一次要冷扫 */
      }
    })()
    return sessionsDiskLoading
  }

  const saveSessionsToDisk = async (sessions) => {
    if (!Array.isArray(sessions) || sessions.length === 0) return
    const now = Date.now()
    if (now - sessionsDiskAt < SESSIONS_DISK_MIN_INTERVAL_MS) return
    sessionsDiskAt = now
    try {
      await mkdir(dirname(sessionsCachePath), { recursive: true })
      const tmp = `${sessionsCachePath}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ at: now, sessions }), 'utf8')
      await rename(tmp, sessionsCachePath)
    } catch (error) {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] 写会话清单种子失败：${error?.message ?? error}`)
    }
  }
  /**
   * 会话清单：5 秒内直接命中；**过期了也先把旧的给你**，后台再刷新（stale-while-revalidate）。
   *
   * 冷扫一次要 1.7 秒（91 条会话，读标题占大头），而这期间用户只是在等面板。
   * 有旧值就先渲染旧值（面板立刻出内容），新值到了下一次打开自然就更新了 ——
   * 只有「进程起来后第一次」仍然要等那 1.7 秒。
   */
  const cachedSessions = async (timings) => {
    const collect = async (bag) => {
      const started = Date.now()
      const value = await collectSessions(ctx, bag)
      if (bag) bag.total = Date.now() - started
      return value
    }
    const now = Date.now()
    if (sessionsCache && now - sessionsCache.at < SESSION_CACHE_MS) return sessionsCache.value
    if (sessionsCache) {
      if (!sessionsRefresh) {
        sessionsRefresh = collect(null)
          .then((value) => {
            sessionsCache = { at: Date.now(), value }
            void saveSessionsToDisk(value)
            return value
          })
          .catch(() => sessionsCache)
          .finally(() => {
            sessionsRefresh = null
          })
      }
      return sessionsCache.value
    }
    // 冷路径：先看磁盘上有没有上一次的清单（进程刚起来时用得上）
    await loadSessionsFromDisk()
    if (sessionsCache) return cachedSessions(timings)
    const value = await collect(timings)
    sessionsCache = { at: Date.now(), value }
    void saveSessionsToDisk(value)
    return value
  }
  const invalidateSessions = () => {
    // 新建会话后必须能看到它：这里清空，下一次会走一次冷扫
    sessionsCache = null
  }

  route(`${API_ROOT}/state`, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '只支持 GET', code: 'method.getOnly' })
      return
    }
    await store.load()
    const timings = {}
    const sessions = await cachedSessions(timings)
    const payload = { ...store.snapshot(), sessions, ai: aiState() }
    // 想看「这 1.7 秒花在哪」：/state?timing=1
    if (String(req.url ?? '').includes('timing=1')) payload.timing = timings
    sendJson(res, 200, payload)
    // 响应已经发出去了，顺手做一次孤儿清理（会话删掉之后那些表的残留）
    void pruneOrphans().catch(() => {})
  })

  /**
   * 清理「会话已经不存在」的残留条目。
   *
   * assignments / hints / ignored / titleHints / titleIgnored / titleChecked /
   * classifyChecked 这七张表都按 sessionId 索引，只增不删；
   * 用久了会给 `/hints` 的每次轮询（20 秒一次）多背几十上百 KB。
   *
   * 三条保护，宁可这次不裁也不能裁错：
   *  1. 会话列表读空 → 直接放弃（多半是服务暂时不可用）；
   *  2. 孤儿超过一半 → 也放弃（正常使用不会有这种比例，更像读到了半个库）；
   *  3. 每小时最多一次。
   */
  const PRUNE_INTERVAL_MS = 60 * 60 * 1000
  let lastPruneAt = 0
  const PRUNE_TABLES = [
    'assignments',
    'hints',
    'ignored',
    'titleHints',
    'titleIgnored',
    'titleChecked',
    'classifyChecked',
  ]
  const pruneOrphans = async () => {
    const now = Date.now()
    if (now - lastPruneAt < PRUNE_INTERVAL_MS) return
    lastPruneAt = now
    const sessionQuery = ctx.get('sessionQuery')
    if (!sessionQuery?.listSessions) return
    let known
    try {
      const records = await sessionQuery.listSessions()
      known = new Set((records ?? []).map((record) => record?.header?.id).filter(Boolean))
    } catch {
      return
    }
    if (known.size === 0) return
    await store.load()
    const state = store.state
    let tracked = 0
    let orphans = 0
    for (const table of PRUNE_TABLES) {
      for (const sessionId of Object.keys(state[table] ?? {})) {
        tracked += 1
        if (!known.has(sessionId)) orphans += 1
      }
    }
    if (orphans === 0) return
    if (orphans * 2 > tracked) {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] 跳过孤儿清理：${orphans}/${tracked} 条对不上，可能是会话列表没读全`)
      return
    }
    await store.mutate((draft) => {
      for (const table of PRUNE_TABLES) {
        const rows = draft[table]
        if (!rows) continue
        for (const sessionId of Object.keys(rows)) {
          if (!known.has(sessionId)) delete rows[sessionId]
        }
      }
    })
    ctx.logger?.info?.(`[${PLUGIN_ID}] 清理了 ${orphans} 条孤立的会话记录`)
  }

  /** 轻量轮询接口：只回待处理提示 + 分类名，供输入框旁的提示条使用。 */
  route(`${API_ROOT}/hints`, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '只支持 GET', code: 'method.getOnly' })
      return
    }
    await store.load()
    const snapshot = store.snapshot()
    sendJson(res, 200, {
      hints: snapshot.hints,
      titleHints: snapshot.titleHints,
      settings: snapshot.settings,
      categories: snapshot.categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      assignments: snapshot.assignments,
    })
  })

  // ---------------------------------------------------------------- 分类维护

  route(`${API_ROOT}/category`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const action = body.action

    if (action === 'create') {
      const name = truncate(body.name, 60)
      if (!name) {
        sendJson(res, 400, { error: '分类名不能为空', code: 'category.nameRequired' })
        return
      }
      const created = await store.mutate((state) => {
        const order = state.categories.length
        const category = {
          id: nextCategoryId(),
          name,
          color: PALETTE[order % PALETTE.length],
          order,
          createdAt: Date.now(),
          archived: false,
        }
        state.categories.push(category)
        // 分类集合变了，之前「无结论」的会话值得重新判断一次
        state.classifyChecked = {}
        return category
      })
      sendJson(res, 200, { category: created, ...store.snapshot() })
      return
    }

    if (action === 'rename') {
      const id = String(body.id ?? '')
      const name = truncate(body.name, 60)
      if (!id || !name) {
        sendJson(res, 400, { error: '缺少分类 id 或名称', code: 'category.missingIdOrName' })
        return
      }
      await store.mutate((state) => {
        const category = state.categories.find((item) => item.id === id)
        if (!category) throw new Error('分类不存在')
        category.name = name
        state.classifyChecked = {}
      })
      sendJson(res, 200, store.snapshot())
      return
    }

    if (action === 'archive' || action === 'unarchive') {
      const id = String(body.id ?? '')
      if (!id) {
        sendJson(res, 400, { error: '缺少分类 id', code: 'category.missingId' })
        return
      }
      const archived = action === 'archive'
      await store.mutate((state) => {
        const category = state.categories.find((item) => item.id === id)
        if (!category) throw new Error('分类不存在')
        category.archived = archived
        // 归档分类不占主列表的位置：未归档在前、归档在后，各自按原顺序重排。
        // 每次都用绝对序号覆盖（而不是累加偏移），反复归档/恢复也不会把 order 越滚越大。
        const active = state.categories.filter((item) => !item.archived).sort((a, b) => a.order - b.order)
        const rest = state.categories.filter((item) => item.archived).sort((a, b) => a.order - b.order)
        active.forEach((item, index) => {
          item.order = index
        })
        rest.forEach((item, index) => {
          item.order = 1000 + index
        })
        state.categories = [...active, ...rest]
        // 可选分类集合变了（归档/恢复），之前问空的会话重新给一次机会
        state.classifyChecked = {}
      })
      sendJson(res, 200, store.snapshot())
      return
    }

    if (action === 'delete') {
      const id = String(body.id ?? '')
      if (!id) {
        sendJson(res, 400, { error: '缺少分类 id', code: 'category.missingId' })
        return
      }
      await store.mutate((state) => {
        state.categories = state.categories.filter((item) => item.id !== id)
        // 重排要按「未归档 / 归档」两段各自编号，否则删除一次就把归档分类的
        // 1000+ 基线压回 0..n，归档和未归档的顺序会混在一起
        const active = state.categories.filter((item) => !item.archived).sort((a, b) => a.order - b.order)
        const rest = state.categories.filter((item) => item.archived).sort((a, b) => a.order - b.order)
        active.forEach((item, index) => {
          item.order = index
        })
        rest.forEach((item, index) => {
          item.order = 1000 + index
        })
        state.categories = [...active, ...rest]
        for (const [sessionId, categoryId] of Object.entries(state.assignments)) {
          if (categoryId === id) delete state.assignments[sessionId]
        }
        for (const [sessionId, hint] of Object.entries(state.hints)) {
          const kept = (hint.candidates ?? []).filter((c) => c.categoryId !== id)
          if (kept.length === 0) delete state.hints[sessionId]
          else state.hints[sessionId] = { ...hint, candidates: kept }
        }
        state.classifyChecked = {}
      })
      sendJson(res, 200, store.snapshot())
      return
    }

    if (action === 'reorder') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
      await store.mutate((state) => {
        const byId = new Map(state.categories.map((item) => [item.id, item]))
        const next = []
        for (const id of ids) {
          const category = byId.get(id)
          if (category) {
            next.push(category)
            byId.delete(id)
          }
        }
        for (const category of byId.values()) next.push(category)
        next.forEach((category, index) => {
          category.order = index
        })
        state.categories = next
      })
      sendJson(res, 200, store.snapshot())
      return
    }

    sendJson(res, 400, { error: `未知操作：${String(action)}`, code: 'action.unknown' })
  })

  // ---------------------------------------------------------------- 归属

  route(`${API_ROOT}/assign`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      sendJson(res, 400, { error: '缺少 items', code: 'assign.missingItems' })
      return
    }
    await store.mutate((draft) => {
      const known = new Set(draft.categories.map((c) => c.id))
      for (const item of items) {
        const sessionId = String(item?.sessionId ?? '')
        const categoryId = item?.categoryId == null ? '' : String(item.categoryId)
        if (!sessionId) continue
        if (categoryId === '' || !known.has(categoryId)) delete draft.assignments[sessionId]
        else draft.assignments[sessionId] = categoryId
        // 手动归入/移出后，该会话的提示与忽略标记都失效
        delete draft.hints[sessionId]
        delete draft.ignored[sessionId]
      }
    })
    sendJson(res, 200, store.snapshot())
  })

  // ---------------------------------------------------------------- 新建会话

  route(`${API_ROOT}/new-session`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const categoryId = String(body.categoryId ?? '')
    const controller = ctx.get('sessionController')
    if (!controller) {
      sendJson(res, 503, { error: 'sessionController 不可用，无法新建会话', code: 'session.controllerUnavailable' })
      return
    }
    const request = {}
    if (isNonEmptyString(body.workspaceId)) request.workspaceId = body.workspaceId
    else if (isNonEmptyString(body.cwd)) request.cwd = body.cwd
    if (isNonEmptyString(body.agentPreset)) request.agentPreset = body.agentPreset

    const created = await controller.create(request)
    if (created?.error) {
      sendJson(res, 400, { error: created.error.code ?? '新建会话失败', code: 'session.createFailed' })
      return
    }
    const sessionId = created?.sessionId
    if (!isNonEmptyString(sessionId)) {
      sendJson(res, 500, { error: '新建会话未返回会话 id', code: 'session.createNoId' })
      return
    }
    await store.mutate((state) => {
      if (state.categories.some((c) => c.id === categoryId)) {
        state.assignments[sessionId] = categoryId
        delete state.hints[sessionId]
        delete state.ignored[sessionId]
      }
    })
    invalidateSessions()
    sendJson(res, 200, { sessionId, ...store.snapshot() })
  })

  // ---------------------------------------------------------------- 手动 AI 分类

  // ---------------------------------------------------------------- 自动提示

  route(`${API_ROOT}/hint`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const action = String(body.action ?? '')
    const sessionId = String(body.sessionId ?? '')
    if (!sessionId) {
      sendJson(res, 400, { error: '缺少 sessionId', code: 'session.missingId' })
      return
    }

    if (action === 'accept') {
      await store.load()
      const hint = store.state.hints[sessionId]
      const candidates = hint?.candidates ?? []
      const wanted = String(body.categoryId ?? '')
      let target = ''
      if (wanted) {
        // 用户在「▾ 换分类」里选的是**完整分类列表**里的任意一项，未必在候选里。
        // 之前这里写的是「找不到就退回 candidates[0]」—— 用户选了 A 却归进了 B。
        if (!store.state.categories.some((c) => c.id === wanted)) {
          sendJson(res, 400, { error: '分类不存在', code: 'category.notFound' })
          return
        }
        target = wanted
      } else if (candidates.length > 0) {
        target = candidates[0].categoryId
      }
      if (!target) {
        sendJson(res, 404, { error: '提示已失效', code: 'hint.expired' })
        return
      }
      await store.mutate((state) => {
        state.assignments[sessionId] = target
        delete state.hints[sessionId]
        delete state.ignored[sessionId]
      })
      sendJson(res, 200, { categoryId: target, ...store.snapshot() })
      return
    }

    if (action === 'dismiss') {
      await store.mutate((state) => {
        delete state.hints[sessionId]
        // 点了忽略就永久退出自动分类，直到用户手动改归属
        state.ignored[sessionId] = Date.now()
      })
      sendJson(res, 200, store.snapshot())
      return
    }

    sendJson(res, 400, { error: `未知操作：${action}`, code: 'action.unknown' })
  })

  // ---------------------------------------------------------------- 会话标题

  /**
   * 标题建议：suggest = 现算一个（不落盘），accept = 真改名，dismiss = 永久不再提示。
   *
   * 改名走 DSH 官方 `sessionController.rename`，改完标题来源变成 user，
   * DSH 自己就不会再按第一轮内容覆盖它了。
   */
  route(`${API_ROOT}/title`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const action = String(body.action ?? '')
    const sessionId = String(body.sessionId ?? '')
    if (!sessionId) {
      sendJson(res, 400, { error: '缺少 sessionId', code: 'session.missingId' })
      return
    }

    if (action === 'accept') {
      const title = String(body.title ?? '')
        .trim()
        .slice(0, 60)
      if (!title) {
        sendJson(res, 400, { error: '标题不能为空', code: 'title.empty' })
        return
      }
      const controller = ctx.get('sessionController')
      if (!controller?.rename) {
        sendJson(res, 503, { error: 'sessionController 不可用，无法改名', code: 'session.renameUnavailable' })
        return
      }
      const result = await controller.rename({ sessionId, title })
      if (result?.error) {
        sendJson(res, 400, { error: result.error.code ?? '改名失败', code: 'session.renameFailed' })
        return
      }
      await store.mutate((state) => {
        delete state.titleHints[sessionId]
        delete state.titleIgnored[sessionId]
      })
      invalidateSessions()
      sendJson(res, 200, { title: result?.title ?? title, ...store.snapshot() })
      return
    }

    if (action === 'dismiss') {
      await store.mutate((state) => {
        delete state.titleHints[sessionId]
        // 点了忽略就永久不再为这条会话提示标题
        state.titleIgnored[sessionId] = Date.now()
      })
      sendJson(res, 200, store.snapshot())
      return
    }

    if (action === 'suggest') {
      const model = resolveModel(ctx, settings)
      if (!model || !ctx.get('llm')) {
        sendJson(res, 503, { error: '没有可用的模型，无法生成标题', code: 'model.unavailable' })
        return
      }
      const sessionQuery = ctx.get('sessionQuery')
      if (!sessionQuery) {
        sendJson(res, 503, { error: 'sessionQuery 不可用', code: 'sessionQuery.unavailable' })
        return
      }
      await store.load()
      const state = store.state
      let current = ''
      try {
        const observation = await sessionQuery.readTitleSnapshot(sessionId)
        current = observation?.title?.title ?? ''
      } catch {
        /* 没标题也能靠对话内容判断 */
      }
      const material = await buildSessionMaterial(sessionQuery, sessionId, {
        title: current,
        forTitle: true,
      })
      if (!current && !material.firstMessage && !material.conversation) {
        sendJson(res, 400, { error: '这条会话还没有可用的内容', code: 'session.emptyMaterial' })
        return
      }
      // 不强制：模型认为标题够贴切就返回空数组，由用户决定要不要手动改
      const { items, usage } = await classifyBatch(ctx, model, [], [{ id: sessionId, material, prior: '' }], {
        askCategory: false,
      })
      const cost = estimateCost(await loadPricing(), model.provider, model.model, usage)
      const suggested = sanitizeTitle(items, sessionId, current) || ''
      await store.mutate((draft) => {
        recordUsage(draft, 'manual', { ...usage, ...cost })
        recordCall(draft, {
          sessionId,
          title: current,
          mode: 'manual',
          scope: 'title',
          reason: '手动重新生成标题',
          outcome: suggested ? 'suggested' : 'none',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costCny: cost.costCny,
        })
      })
      sendJson(res, 200, {
        current,
        title: suggested,
        usage: store.snapshot().usage,
      })
      return
    }

    sendJson(res, 400, { error: `未知操作：${action}`, code: 'action.unknown' })
  })

  // ---------------------------------------------------------------- 设置

  route(`${API_ROOT}/settings`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    await store.mutate((state) => {
      if (typeof body.autoClassify === 'boolean') state.settings.autoClassify = body.autoClassify
      // 「新建会话落在哪个工作区」是用户的长期偏好，落盘保留
      if (typeof body.newSessionWorkspaceId === 'string') {
        state.settings.newSessionWorkspaceId = body.newSessionWorkspaceId
      }
      if (typeof body.showRowMark === 'boolean') state.settings.showRowMark = body.showRowMark
      if (['day', 'week', 'month'].includes(body.costRange)) state.settings.costRange = body.costRange
      if (body.titleCheckEvery !== undefined) {
        state.settings.titleCheckEvery = Math.round(
          clampNumber(body.titleCheckEvery, 0, 100, state.settings.titleCheckEvery),
        )
      }
      if (body.turnCount !== undefined) {
        const raw = Number(body.turnCount)
        // 上限跟界面滑块一致（1~20），避免 Host 允许 500、界面只能到 20 的错位
        state.settings.turnCount = raw === 0 ? 0 : Math.round(clampNumber(raw, 1, 20, state.settings.turnCount))
      }
      if (body.minConfidence !== undefined) {
        state.settings.minConfidence = clampNumber(body.minConfidence, 0, 1, state.settings.minConfidence)
      }
      // 侧边栏筛选清单的排序方式：只是展示偏好，改了不影响任何判断
      if (['activity', 'created'].includes(body.filterSort)) state.settings.filterSort = body.filterSort
      // 提示词/模板：空串表示「用默认」
    })
    sendJson(res, 200, { settings: store.snapshot().settings })
  })

  // ---------------------------------------------------------------- 按最新素材重新判断

  /**
   * 把所有「待处理建议」清掉，再按当前素材重新判断一遍。
   *
   * 素材的读取逻辑修过（之前读错了字段，判断其实只看过标题），
   * 老的建议是用坏素材生成的，需要一次重算。逐条串行调用，避免一次打满模型并发。
   */
  route(`${API_ROOT}/rejudge`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const limit = Math.round(clampNumber(body.limit, 1, 50, 20))

    await store.load()
    const stale = new Set([
      ...Object.keys(store.state.hints ?? {}),
      ...Object.keys(store.state.titleHints ?? {}),
    ])
    const ids = [...stale].slice(0, limit)

    // 清理必须「一条一条来」：以前是先把这批 50 条的建议全删掉再开始算，
    // 中途超时/断连就是「钱已经花了，建议全没了」。现在每条算之前才清它自己，
    // 失败的只影响那一条，后面的还能继续。
    const results = []
    for (const sessionId of ids) {
      try {
        await store.mutate((draft) => {
          delete draft.hints[sessionId]
          delete draft.titleHints[sessionId]
          delete draft.titleIgnored[sessionId]
          delete draft.titleChecked[sessionId]
          delete draft.classifyChecked[sessionId]
        })
        await autoClassifySession(sessionId, undefined, { force: true, mode: 'manual' })
        const hint = store.state.hints[sessionId]
        const titleHint = store.state.titleHints[sessionId]
        results.push({
          sessionId,
          categoryId: hint?.candidates?.[0]?.categoryId ?? '',
          title: titleHint?.title ?? '',
        })
      } catch (error) {
        results.push({ sessionId, error: String(error?.message ?? error) })
      }
    }

    sendJson(res, 200, {
      processed: ids.length,
      remaining: Math.max(0, stale.size - ids.length),
      results,
      ...store.snapshot(),
    })
  })

  // ---------------------------------------------------------------- 调用明细（钱花在哪）

  route(`${API_ROOT}/calls`, async (req, res) => {
    await store.load()
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      if (body.action === 'clear') {
        await store.mutate((draft) => {
          draft.calls = []
        })
        sendJson(res, 200, { calls: [], cleared: true })
        return
      }
      sendJson(res, 400, { error: '未知操作', code: 'action.unknown' })
      return
    }
    sendJson(res, 200, { calls: store.state.calls ?? [], usage: store.snapshot().usage, limit: CALL_LOG_LIMIT })
  })

  // ---------------------------------------------------------------- 自动分类：每轮结束

  /** 同一会话的自动判断串行化，避免一次 turn 结束触发多次并发模型调用。 */
  const pendingAuto = new Map()

  /**
   * 每轮结束跑一次：分类已经定好的会话也可能只跑标题判断。
   *
   * needsCategory：还没归类、没被忽略、有可用分类
   * needsTitle：开着标题检查、标题不是用户手改的（source=user）、没被忽略标题、
   *             距上次检查已经过了 titleCheckEvery 轮
   */
  const autoClassifySession = async (sessionId, turn, options = {}) => {
    // force = 用户手动点「判断一下」：不受自动节奏（冷却、次数上限）限制
    const force = options.force === true
    const mode = options.mode === 'manual' ? 'manual' : 'auto'
    await store.load()
    const state = store.state
    // 总开关只关「自动」这条链：用户手动点「判断一下」/重算时照样要跑，
    // 否则关掉自动分类之后这些入口会静默不做事，语义是错的。
    if (!state.settings.autoClassify && !force) return

    const activeCategories = state.categories.filter((c) => !c.archived)
    // 问过但模型给不出结论的会话不能每轮都重问：隔几轮再问，连续问空几次就停。
    const classifyCheck = state.classifyChecked[sessionId]
    const classifyAttempts = classifyCheck?.attempts ?? 0
    const classifyCooling =
      !classifyCheck ||
      (Number.isFinite(turn) ? turn - classifyCheck.turn : 0) >= CLASSIFY_RECHECK_TURNS
    const needsCategory =
      !state.assignments[sessionId] &&
      !state.ignored[sessionId] &&
      !state.hints[sessionId] &&
      (force || (classifyAttempts < CLASSIFY_ATTEMPT_CAP && classifyCooling)) &&
      activeCategories.length > 0

    const sessionQuery = ctx.get('sessionQuery')
    if (!sessionQuery) return

    let title = ''
    let titleSource = ''
    try {
      const observation = await sessionQuery.readTitleSnapshot(sessionId)
      title = observation?.title?.title ?? ''
      titleSource = observation?.title?.source?.kind ?? ''
    } catch {
      /* 没标题也能靠消息内容判断 */
    }

    const gap = state.settings.titleCheckEvery
    const lastTurn = Number.isFinite(state.titleChecked[sessionId]) ? state.titleChecked[sessionId] : -1
    const turnGap = Number.isFinite(turn) ? turn - lastTurn : Number.POSITIVE_INFINITY
    // 「每 N 轮」就是字面意思：设成 1 就每轮都看。
    // 以前这里还乘了一个「连续不用改就 ×2 ×4 ×8」的退避倍数，用户设了 1 却隔 8 轮才检查一次，
    // 看起来就是「设置没生效」。省钱交给用户自己把频率调大，不再暗改。
    // 挂着一张建议时也照常判断：有新结论就替换掉那张，没有结论就保留原建议。
    const needsTitle =
      titleSource !== 'user' &&
      (force || (gap > 0 && !state.titleIgnored[sessionId] && turnGap >= gap))

    if (!needsCategory && !needsTitle) return

    const model = resolveModel(ctx, settings)
    if (!model || !ctx.get('llm')) return

    let workspaceTitle = ''
    try {
      const registry = ctx.get('workspaceRegistry')
      if (registry) {
        const owner = registry.list().find((workspace) => workspace.sessionIds?.includes(sessionId))
        workspaceTitle = owner?.title ?? ''
      }
    } catch {
      /* 工作区只是素材里的一个字段，取不到不影响判断 */
    }
    const material = await buildSessionMaterial(sessionQuery, sessionId, {
      title,
      workspace: workspaceTitle,
      turnCount: state.settings.turnCount,
      // 这一轮要判断标题：多带一段整条会话的诉求，标题才不会停在最后一轮
      forTitle: needsTitle,
      onError: (error) =>
        ctx.logger?.warn?.(`[${PLUGIN_ID}] 读取会话素材失败（${sessionId}）：${error?.message ?? error}`),
    })
    // 连首条消息都读不到、也没有标题，就没有判断依据，不花这次钱
    if (!title && !material.firstMessage && !material.conversation) return

    // 之前判断过的分类名一并告诉模型：如果结论变了，它会给出新的候选，
    // 两个候选都会留在提示里，不会互相覆盖。
    const priorNames = (state.hints[sessionId]?.candidates ?? [])
      .map((candidate) => activeCategories.find((c) => c.id === candidate.categoryId)?.name)
      .filter(Boolean)
    const prior = priorNames.length > 0 ? priorNames.join(' / ') : ''

    const { items: raw, usage } = await classifyBatch(
      ctx,
      model,
      needsCategory ? activeCategories.map((c) => ({ id: c.id, name: c.name })) : [],
      [{ id: sessionId, material, prior }],
      { askCategory: needsCategory },
    )
    const suggestions = needsCategory
      ? sanitizeSuggestions(raw, [{ id: sessionId }], activeCategories, state.settings.minConfidence)
      : []
    const titleSuggestion = needsTitle ? sanitizeTitle(raw, sessionId, title) : ''
    const cost = estimateCost(await loadPricing(), model.provider, model.model, usage)

    await store.mutate((draft) => {
      recordUsage(draft, mode, { ...usage, ...cost })
      recordCall(draft, {
        sessionId,
        title,
        mode,
        scope: needsCategory && needsTitle ? 'both' : needsCategory ? 'classify' : 'title',
        reason: Number.isFinite(turn) ? `第 ${turn} 轮结束` : '手动触发',
        outcome: suggestions.length > 0 || titleSuggestion ? 'suggested' : 'none',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costCny: cost.costCny,
      })
      if (needsTitle) draft.titleChecked[sessionId] = Number.isFinite(turn) ? turn : 0
      if (titleSuggestion && !draft.titleIgnored[sessionId]) {
        draft.titleHints[sessionId] = { title: titleSuggestion, at: Date.now() }
      }
      if (needsCategory) {
        // 记下这次判断；没结论就累计次数，连续问空 CLASSIFY_ATTEMPT_CAP 次后不再自动问
        const attemptTurn = Number.isFinite(turn) ? turn : 0
        draft.classifyChecked[sessionId] =
          suggestions.length > 0
            ? { turn: attemptTurn, attempts: 0 }
            : { turn: attemptTurn, attempts: classifyAttempts + 1 }
      }
      if (suggestions.length === 0) return
      // 期间可能已被手动归类/忽略，落库前再确认一次
      if (draft.assignments[sessionId] || draft.ignored[sessionId]) return
      const previous = draft.hints[sessionId]?.candidates ?? []
      const next = suggestions.map((s) => ({
        categoryId: s.categoryId,
        confidence: s.confidence,
        at: Date.now(),
      }))
      // 新结论排最前，旧候选保留在后面（同一分类只留最新的那条）
      for (const candidate of previous) {
        if (!next.some((item) => item.categoryId === candidate.categoryId)) next.push(candidate)
      }
      draft.hints[sessionId] = { candidates: next.slice(0, 4), updatedAt: Date.now() }
    })
    if (suggestions.length > 0) {
      ctx.logger?.info?.(`[${PLUGIN_ID}] 为 ${sessionId} 生成分类提示：${suggestions[0].categoryId}`)
    }
  }

  // 正在跑模型判断的会话（一次判断 2~3 秒，这期间再来一轮不能在旁边再开一次）
  const runningAuto = new Set()
  // 每个会话最近一次的轮次号：补跑时用它，节奏判断（隔几轮再问）才不会失真
  const latestTurn = new Map()

  const scheduleAuto = (sessionId, turn) => {
    if (Number.isFinite(turn)) latestTurn.set(sessionId, turn)
    // 已经在排队的，合并到那一次
    if (pendingAuto.has(sessionId)) return
    // 已经在跑的：直接合并掉这一次（README 承诺的就是合并）。
    // 判断一次要 2~3 秒，这期间又结束了一轮，用原来那次的结果即可 ——
    // 真要因为新内容改判，下一轮结束还会再触发一次，没必要现在并着花两份钱。
    if (runningAuto.has(sessionId)) return
    const timer = setTimeout(async () => {
      pendingAuto.delete(sessionId)
      runningAuto.add(sessionId)
      try {
        await autoClassifySession(sessionId, latestTurn.get(sessionId))
      } catch (error) {
        ctx.logger?.warn?.(`[${PLUGIN_ID}] 自动分类失败（${sessionId}）：${error?.message ?? error}`)
      } finally {
        runningAuto.delete(sessionId)
        latestTurn.delete(sessionId)
      }
    }, 800)
    pendingAuto.set(sessionId, timer)
  }

  /**
   * 单会话判断一次。面板上「这条会话现在归哪类？」与排障都用它；
   * 与自动触发走同一条规则（已分类 / 已忽略 / 已有提示都不重复判断）。
   */
  route(`${API_ROOT}/classify-session`, async (req, res) => {
    if (!requirePost(req, res)) return
    const body = await readJsonBody(req)
    const sessionId = String(body.sessionId ?? '')
    if (!sessionId) {
      sendJson(res, 400, { error: '缺少 sessionId', code: 'session.missingId' })
      return
    }
    await store.mutate((draft) => {
      delete draft.classifyChecked[sessionId]
    })
    await autoClassifySession(sessionId, undefined, { force: true, mode: 'manual' })
    const snapshot = store.snapshot()
    sendJson(res, 200, { hint: snapshot.hints[sessionId] ?? null })
  })

  disposers.push(
    ctx.effect(() =>
      ctx.on('session/event', (session, event) => {
        if (!session?.id || !event) return
        if (event.type !== 'turn/end') return
        if (event.data?.reason?.kind !== 'completed') return
        // 子代理 / fork 出来的会话不上面板，判断出来的提示也没人看得见 —— 不为它们花钱
        const header = session.header ?? {}
        if (
          header.origin === 'subagent' ||
          header.parentSession !== undefined ||
          Number(header.delegationDepth) > 0
        ) {
          return
        }
        scheduleAuto(session.id, event.data?.turn)
      }),
    ),
  )

  disposers.push(
    ctx.effect(() => () => {
      for (const timer of pendingAuto.values()) clearTimeout(timer)
      pendingAuto.clear()
      runningAuto.clear()
      latestTurn.clear()
    }),
  )

  store.load().catch((error) => {
    ctx.logger?.warn?.(`[${PLUGIN_ID}] 状态文件读取失败：${error?.message ?? error}`)
  })
  ctx.logger?.info?.(`[${PLUGIN_ID}] 已加载，状态文件：${storePath}`)

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
