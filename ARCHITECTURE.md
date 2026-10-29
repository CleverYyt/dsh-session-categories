# dsh-session-categories 实现说明

> 一句话：**一个 DSH 插件的两半**——Host 半负责「读会话、问模型、存状态」，Client 半负责「往原生界面上挂东西」。
> 插件不接管侧边栏，也不改会话日志，只是往已有槽位里插自己的 UI 和一行自己维护的 JSON。

- 代码：`index.js`（Host，~1970 行）、`client.js`（Client，~3420 行）
- 打包：`package.json` 的 `dsh.bundle.patch` + `dsh.client`，`cordis.patch.yml` 里 `insert` 一条插件行
- 存储：`$DSH_HOME/storages/dsh-session-categories/state.json`（**唯一**持久化文件）

---

## 1. 两半怎么跑起来

```
DSH 宿主进程                                  浏览器（Web GUI）
┌──────────────────────────────┐            ┌────────────────────────────────┐
│ index.js  apply(ctx, config) │            │ client.js                      │
│  · webServer 注册 /api/*     │◀── fetch ──│  · 读状态、发写操作              │
│  · session/event 监听        │            │  · 往 8 个槽位注入 UI            │
│  · llm.stream 调模型         │            │  · 往原生 DOM 插「按分类筛选」    │
│  · state.json 读写           │            │                                │
└──────────────────────────────┘            └────────────────────────────────┘
```

- Host：`export const inject = ['webServer']`，其余服务（`sessionQuery`、`sessionController`、`workspaceRegistry`、`llm`、`agentDefaultModel`、`costMeter`）全部用 `ctx.get(name)` **懒取**——没装某个插件也不至于让本插件起不来。
- Client：`window.__ModuleLoader__.load({ id, factory(require) })`，React 用 `require('react')`，`inject: ['slots', 'uiWorkspace', 'locale', 'layout']`。
- **两半之间只走 HTTP**（`/dsh-session-categories/api/*`），没有生成式 Remote、没有 WebSocket。

---

## 2. 存储

### 2.1 位置与形态

```
$DSH_HOME/storages/dsh-session-categories/state.json     ← 唯一真相
```

单文件 JSON。**刻意不写进会话日志**：分类是「用户的整理结果」，不是会话内容的一部分，写在会话里会让升级/回滚/换 profile 都受牵连；单文件也让「备份/搬家」就是拷一个文件。

### 2.2 结构

```jsonc
{
  "version": 1,
  "categories": [                    // 分类定义，按 order 升序
    { "id": "c_xxxx", "name": "线上问题排查", "color": "#c9a227",
      "order": 3, "createdAt": 1730000000000, "archived": false }
  ],
  "assignments":  { "sessionId": "categoryId" },        // 会话 → 分类（唯一归属）

  "hints":        { "sessionId": { "candidates": [ { "categoryId": "...", "confidence": 0.82, "at": 173... } ], "updatedAt": 173... } },
  "ignored":      { "sessionId": 173... },              // 忽略分类建议 → 该会话永久退出自动分类

  "titleHints":   { "sessionId": { "title": "…", "at": 173... } },
  "titleIgnored": { "sessionId": 173... },              // 忽略标题建议 → 不再提示标题
  "titleChecked": { "sessionId": 12 },                  // 上次判断标题时的轮次

  "classifyChecked": { "sessionId": { "turn": 12, "attempts": 2 } },  // 自动分类节奏控制

  "calls": [ { "at", "sessionId", "title", "mode", "scope", "reason", "outcome",
               "inputTokens", "outputTokens", "costCny" } ],        // 最多 300 条，新的在前

  "settings": {
    "autoClassify": true, "newSessionWorkspaceId": "",
    "showRowMark": true, "costRange": "day",
    "turnCount": 0, "titleCheckEvery": 1, "minConfidence": 0.35,
    "filterSort": "created"
  },

  "usage": {
    "auto":   { "calls": 0, "inputTokens": 0, "outputTokens": 0, "costUsd": 0, "costCny": 0, "lastAt": 0 },
    "manual": { … },
    "buckets": { "2026-10-23": { "auto": { … }, "manual": { … } } }   // 只留最近 100 天
  }
}
```

要点：

- **归属是一对一**：一个会话最多在一个分类里（`assignments` 是 map，不是数组）。会话不在 map 里 = 未分类。
- **提示不是归属**：`hints` 只是「建议」，采纳后才写进 `assignments`，然后删掉 `hints`。分类建议支持**多候选**（最多 4 条）：模型改了结论时旧候选不会丢，界面上就是那几个 chip。
- **`ignored` / `titleIgnored` 是刹车**：忽略后不再自动判断，手动移动/重新生成会清掉对应标记。
- **`usage` 既有总账也有日分桶**：当日/本周/本月都从 `buckets` 现算（`periodUsage`），总账只用于「从装上到现在」。

### 2.3 写入：`CategoryStore`（index.js）

| 关注点 | 做法 |
| --- | --- |
| 并发 | 所有写操作走 `mutate(fn)`，内部用 `this.tail` 串成**单条队列**，不会有两次读-改-写互相覆盖 |
| 原子性 | 先写 `state.json.<pid>.tmp` 再 `rename` 覆盖——崩在写一半也不会留半个文件 |
| 容错 | 读盘后统一过 `normalizeState`：缺字段补默认、脏数据丢弃、`categories` 按 `order` 重排、孤儿归属（分类已删）直接不认 |
| 孤儿清理 | `assignments` / `hints` / `ignored` / `titleHints` / `titleIgnored` / `titleChecked` / `classifyChecked` 七张按 sessionId 索引的表只增不删。`/state` 响应后顺手清理一次（每小时最多一次），三条保护：会话列表读空 → 跳过；孤儿占比超过一半 → 跳过；正常情况按「会话已不存在」删除 |
| 坏文件 | 解析失败不会把失败缓存住：把坏文件 `rename` 成 `state.json.bad-<ts>`，按默认状态继续并落盘（落盘失败也只记一笔，读接口照样可用）。修好/换掉文件后下次启动即可恢复 |
| seed 语义 | 只有**文件不存在**才写 `seedCategories`。不能用「分类列表为空」判断，否则用户把分类删空后，下一次写操作会重新 `load()` 把初始分类写回来 |
| 兼容 | 旧格式（`hints` 里单条 `categoryId`）在 `normalizeState` 里就地升级成 `candidates` 数组 |
| 出口 | `snapshot()` 返回**浅拷贝**给 HTTP 层，路由里改对象改不到内存里的 state |

另外还做了两处**读侧缓存**（都不是状态，丢了无所谓）：

- 会话清单 5 秒缓存（`cachedSessions`）：折叠会话标题要逐条读日志，近百条 1~2 秒；分类增删改不改会话清单，没必要每次重拉。新建会话时主动失效。
- 价格目录 10 分钟缓存（`loadPricing`）：`costMeter.getState()` 会构建完整账单，代价不小。

---

## 3. Host 半的功能实现

### 3.1 路由（全部在 `/dsh-session-categories/api` 下）

| 路由 | 方法 | 干什么 | 界面在用 |
| --- | --- | --- | --- |
| `/state` | GET | 全量快照：分类、会话清单（含标题/工作区/活动时间）、归属、设置、用量档位 | ✅ |
| `/hints` | GET | 只要提示相关（`hints` / `titleHints` / 分类三元组）——给 20 秒轮询用，比 `/state` 便宜得多 | ✅ |
| `/category` | POST | `create` / `rename` / `archive` / `delete` / `reorder` | ✅（`reorder` 暂无 UI） |
| `/assign` | POST | 会话 → 分类（空值 = 移出分类，回未分类） | ✅ |
| `/new-session` | POST | 在指定分类下新建会话（可带工作区/预设），建完直接归属 | ✅ |
| `/hint` | POST | 采纳 / 忽略某条分类建议 | ✅ |
| `/title` | POST | 标题建议：`suggest`（现算一次）/ `accept` / `dismiss` | ✅ |
| `/settings` | POST | 保存设置（字段见 2.2） | ✅ |
| `/calls` | GET/POST | 调用明细（GET，附带明细上限 `limit`）/ 清空（POST） | ✅ |

> 所有失败响应都带机器可读的 `code`（如 `body.invalidJson`、`category.nameRequired`），客户端按码翻译，英文界面不会弹中文报错；没有码时才退回 `error` 原文。
| `/classify-session` | POST | 对**单条**会话强制判断一次（清掉节奏记录后跑）——排障用 | ❌ 仅 API |
| `/rejudge` | POST | 清空待处理建议，按当前素材逐条串行重算（`limit` 1~50，默认 20） | ❌ 仅 API |

写操作统一返回 `{ ...snapshot() }` 或增量，客户端用 `applyState()` 合并，**不重拉 `/state`**。

**请求来源校验**（`route()` 包装里，读写都查）：

1. `checkHost`：`Host` 必须是回环地址（`localhost` / `127.x` / `::1`），否则 403。这一步防的是 **DNS rebinding** —— 只比 `Origin` 和 `Host` 是不够的，攻击者把自己的域名解析到 127.0.0.1 时，浏览器发来的两者都是 `evil.example`，校验形同虚设，而它能读 `/state` 里的会话标题、删分类、甚至花我们的钱调模型。
2. `checkWrite`（仅非 GET）：带 `Origin` 且与 `Host` 不一致 → 403；`Content-Type` 不是 `application/json` → 415。挡住无 preflight 的跨站简单请求。
3. 没有 `Origin` 的调用（curl、脚本、验收脚本）照常放行。

### 3.2 会话清单：`collectSessions(ctx)`

拼出面板需要的那份列表：

1. `sessionController.list()` → 拿 `updatedAt`（**活动时间**，`sessionQuery` 的记录里只有 `createdAt`）和 `blank` 标记。
2. `sessionQuery.listSessions()` → 过滤掉 `origin === 'subagent'`、有 `parentSession`、`delegationDepth > 0`（**子代理/fork 不进面板，也不花钱**）和空白会话。
3. `readTitleSnapshots(ids)` 批量取标题；没标题的并发补一次「首条用户消息」截 32 字兜底。
4. `workspaceRegistry.list()` → 会话所属工作区。
5. 丢弃「既没标题也没内容」的会话，按 `updatedAt desc, createdAt desc` 排序。

### 3.3 素材构建：`buildSessionMaterial(...)`

把「一条会话」压成模型能看的一段文本，**按轮聚合**：

- `readSurface(sessionId)` 拿 surface 事件；只认 `user/message`、`assistant/message`，正文用
  `contentText(e.data?.message?.content) || contentText(e.data?.content)`（**两种形状都要认**，只认一种会静默拿到空串）。
- 一条**真人**用户消息开一轮；`data.source.kind !== 'user'` 的注入消息（工作区规则、运行时快照、时间戳、子任务完成通知、回滚占位）**直接丢掉**——它们不是用户说的话，混进来只会带偏判断。
- 同一轮里后出现的助手文本覆盖前面的（最终回复优先）；助手回复超长时 `clipReply` 保留 300 字头 + 200 字尾。
- `forTitle` 时对话部分换成 `titleDigestTurns(turnList)`：首轮 + 最近 20 轮用户消息的摘要——**判断标题必须看整条会话在干什么**，只看最后一轮必然得出「执行完成，检查一下」这种标题。
- `turnCount`（设置里的「对话轮次」）决定分类素材取最近几轮，`0` = 全部。

### 3.4 自动分类：一轮结束后发生什么

触发点只有一个：`ctx.on('session/event')` 里 `event.type === 'turn/end'` 且 `event.data.reason.kind === 'completed'`（中途打断/失败不判断）。子代理会话直接 return。

```
turn/end(completed)
   │
   ├─ scheduleAuto(sessionId, turn)        ← 同一会话 800ms 内只排一次（pendingAuto）
   │
   └─ autoClassifySession()
        ├─ 算 needsCategory / needsTitle  ← 门控，两个都为 false 就直接返回（不花钱）
        ├─ readTitleSnapshot()            ← 当前标题 + 标题来源（用户手改的 source=user 不碰）
        ├─ buildSessionMaterial()
        ├─ classifyBatch()                ← 一次 llm.stream，一次问完「分类 + 标题」
        ├─ sanitizeSuggestions / sanitizeTitle
        └─ store.mutate()                 ← 记 usage、记 calls、写 hints/titleHints、更新节奏记录
```

**同一会话不并发**：`scheduleAuto` 维护 `pendingAuto`（排队中）、`runningAuto`（正在调模型）、`latestTurn`（最近轮次）。判断一次要 2~3 秒，这期间同一会话又结束一轮时**直接合并掉**（不会再起一次调用），否则两轮之间会并着花两份钱。

**什么时候才真的问模型（门控）**：

| 条件 | 规则 |
| --- | --- |
| `needsCategory` | 还没归类 **且** 没被忽略 **且** 没有待处理建议 **且** 有可用（未归档）分类 **且** 节奏允许（见下） |
| `needsTitle` | 标题来源不是用户手改 **且** `titleCheckEvery > 0` **且** 没被忽略标题 **且** 距上次检查已过 `titleCheckEvery` 轮（字面值，不乘任何倍数） |
| 强制 | `force = true`（手动「判断一下」/`/classify-session`）跳过节奏限制 |
| 素材为空 | 连标题和首条消息都没有 → 直接返回，不为空会话付钱 |

**节奏控制（省钱的核心）**：

- 分类：判过但没结论的会话，记 `classifyChecked = { turn, attempts }`。下次要等 `CLASSIFY_RECHECK_TURNS = 3` 轮之后，连续问空 `CLASSIFY_ATTEMPT_CAP = 5` 次就彻底不再自动问。
- 标题：**按用户设定的频率（「每 N 轮」）字面执行**，设 1 就是每轮都看。不做「连续不用改就翻倍拉开间隔」的暗改（以前有，用户会以为设置没生效）；挂着一张建议时也照常判断，有新结论就替换那张，没结论就保留。省钱靠用户把频率调大，而不是插件偷偷改。
- 分类集合变化（新建/改名/归档/删除分类）会清空 `classifyChecked`——之前问空是因为可选集合不对，值得重新给一次机会。

**提示的合并规则**：新结论排最前，旧候选按「同一分类只留最新」保留在后面，最多 4 条。落库前会再确认一次「这期间没被手动归类/忽略」。

**一次调用问两件事**：`classifyBatch(..., { askCategory })` 在 `needsCategory && needsTitle` 时把两件事塞进**同一个 prompt**（分类提示词里带标题规则），只付一次钱；已经归好类的会话则用纯标题提示词（`askCategory: false`）。

### 3.5 提示词与解析

- `SYSTEM_PROMPT`（分类）：判归属；规则里要求「对象 + 具体操作」的标题改写也一起给；与所有分类无关返回 `none`。
- `TITLE_SYSTEM_PROMPT`（只说标题）：要求标题**同时具备「对象」与「具体操作」**，明确禁止 `会话 / 对话 / 内容 / 数据 / 文件 / 脚本 / 配置 / 任务 / 问题` 这类空壳词当对象，附「差 → 好」示例（含纯技术、纯问答样例）；两样都写清或内容太轻时返回 `[]`（= 不用改）。
- `parseSuggestionArray(text)`：宽容解析——模型偶尔会包 ```json 或前后加解释，只截最外层 `[...]`；解析不出来就当「没结论」，不抛错（抛错会让调用记不上账）。
- 置信度低于 `minConfidence` 的建议直接丢弃（`sanitizeSuggestions`）。

### 3.6 钱：记账与明细

- 价格来自 **dsh-cost-meter** 的价格目录（`config.prices`，美元/1M tokens，用它的 `exchangeRate` 折人民币），取不到就只记 token、不猜钱。
- `estimateCost` 按 `cacheMiss`（输入）/`output`（输出）估算；`recordUsage` 同时累加到总账和**当天分桶**；`calls` 里记一条明细（模式 auto/manual、范围 classify/title/both、结论 suggested/none、token、费用），上限 300 条。
- 客户端「调用记录」页用 `usage.periods` 出总数，用 `calls` 出明细，两者差额用一行说明兜住（明细是后加的，之前的调用只进了总数）。

---

## 4. Client 半的功能实现

### 4.1 数据层

极简订阅式 store（`createStore`，`get/set/subscribe`），没有引入状态库。三个入口：

| 函数 | 时机 | 说明 |
| --- | --- | --- |
| `refreshState()` | 激活时、写操作后需要全量时 | `GET /state`；`stateInflight` 去重 |
| `refreshHints()` | 启动时 + 20 秒轮询（页面隐藏时跳过） | `GET /hints`，只刷提示；**还没拿到全量状态时会顺手用它撑起一份 lite data**（categories / assignments / settings，`sessionsLoaded: false`），行首色标、悬停卡片、筛选入口的文案都靠它 |
| `mutate(path, body)` | 所有写操作 | POST，失败 `toast` 并把错误吞掉（不打断界面） |

写操作成功后用 `applyState()` **把响应合并进当前 data**，而不是重拉 `/state`——`/state` 要折叠全部会话标题，几百条时 1~2 秒，会让「删分类」这种动作卡两秒。

`/state` 是唯一「贵」的接口（要扫全部会话、读标题、给没标题的会话补首条消息；89 条会话冷调用 ≈1.85s），所以**启动时不调它**：页面加载只拉 `/hints`。

**三层缓存，目标是「看不到等待」**：

1. **内存 + SWR**：5 秒内直接命中；过期后立刻返回上一次的结果，后台重扫（stale-while-revalidate）。
2. **磁盘种子**：每次刷新成功后把清单写一份到 `storages/dsh-session-categories/sessions-cache.json`（清单非空、且距上次写超过 1 分钟才写，避免「读空了覆盖好数据」）。进程刚起来时先读它，所以**第一次打开面板也是毫秒级**，真正的冷扫在后台做。
3. **客户端预热**：启动后空闲时（`requestIdleCallback`，兜底 1.5s）预取一次；鼠标悬停到侧边栏「分类」图标也触发预取。等用户点下去时通常已经热了。

想看冷扫的耗时构成：`GET /state?timing=1`，会多回一个 `timing: { controllerList, listSessions, titles, workspaces, firstUserText, total }`。

代价由使用点承担，并且都不阻塞操作：
- 分类面板打开时显示「加载中」，因为面板本体就要标题；
- 筛选清单打开时会顺手后台拉一次（只为把条数补准），清单本身立刻可点、点完立刻生效；
- 侧边栏筛选不依赖会话清单（见 4.4），所以「点筛选等 3 秒」那种体验不会再出现。

### 4.2 注入点（槽位）

原生界面没有「会话分类」这种插槽，所以是靠**已有槽位 + 一处原生 DOM 注入**拼出来的：

| 槽位 | id | 渲染什么 |
| --- | --- | --- |
| `sidebar.panellist` | `session-categories` | 侧边栏面板列表里的图标入口 |
| `main`（key 同 id） | — | 主区域分类页（`CategoriesPanel`） |
| `sidebar.session.row.leading` | `session-category-mark` | 会话行首的分类色条 |
| `sidebar.session.row.hover` | `session-category-hover` | 悬停卡片里的一行「分类 · 名称」 |
| `sidebar.workspaces.session.menu.item` | `session-category` | 右键菜单「移动到分类」 |
| 同上 | `session-title` | 右键菜单「重新生成标题」 |
| `sidebar.workspaces.session.row.action` | `session-category-move` | 行尾的移动按钮 |
| `shell.overlay` | `session-category-move-dialog` | 移动到分类的弹窗（从右键菜单进来时，等原生菜单卸载后再开，否则两层浮层会互相压住） |
| 同上 | `session-title-dialog` | 生成标题的弹窗 |
| 同上 | `session-category-filter-panel` | 侧边栏「按分类筛选」清单（侧边弹出） |
| `conversation.input.left` | `session-category-hint` | 输入框左侧的建议 chip |

> 原生**没有**「工作区上方」的槽位，所以「按分类筛选」入口是 `mountSidebarFilterBar()` 直接往原生 DOM 里插一个 `div`（找 `[data-row-key^="workspace:"]` 往上找到滚动容器，`insertBefore`），再用 500ms 的 `getElementById` 巡检把它补回来（不用 MutationObserver：流式输出时 mutation 太密）。这一行优先插在**滚动容器外面**（`scroller.parentElement.insertBefore(wrap, scroller)`）：不随列表滚动，也永远不会盖住会话行，于是样式可以完全透明、跟原生条目一致（无边框、无底色、悬停才有底色）——侧边栏是半透明叠壁纸的，任何写死的底色都会露一条色差带。横向内边距直接抄滚动容器的 `paddingLeft/Right`，保证和「工作区」标题左对齐。只有拿不到外层容器时才退回「塞进列表 + `position:sticky` + 背景模糊」的兜底（`data-dsc-mode="inside"`）。悬停底色直接用原生行的 `--dsw-alias-interactive-bg-hover`（`#2631480f` 这类半透明冷灰），不要自己用 `color-mix` 调——调出来的偏暖/偏深，和旁边的会话行一眼就能看出色差。

### 4.3 主面板 `CategoriesPanel`

- 顶部：工作区下拉、新建分类、`待处理建议 N`（默认收起）、归档入口、设置、关闭。
- 主体：每个分类一块，块内是会话行；搜索（标题 / 会话 id / 工作区 / 分类名）。
- 排序：分类按**活跃度**（分类内最新会话的 `updatedAt` 倒序，空分类沉底、空分类之间新建的在前）；未分类块恒在最后。
- 归档是**独立视图**（`archivedView`），主列表里完全不出现归档分类。
- 会话行有「移动到分类」按钮 → 展开一排分类 chip（就地改归属，不用开弹窗）。

### 4.4 侧边栏按分类筛选

三段配合，缺一不可：

1. **入口**：注入的那一行按钮 + 过滤状态下的 `✕`（直接清筛选）。
2. **筛选本体**：不接管列表，而是往 `<head>` 写**一条固定规则**——
   `html[data-dsc-filter="on"] [data-row-key^="session:"]:not([data-dsc-allow]){display:none!important}`，
   命中行由 JS 打上 `data-dsc-allow`（默认隐藏 + 显式放行）。早先是按允许的 id 生成 N 个 `:not(...)`，
   每个会话行都要匹配 N 个选择器（2000 条会话 ≈ 400 万次属性比较），现在是一次 `querySelectorAll` + 属性读写，O(行数)。
   新渲染出来的行（原生懒渲染「展开其余 N 个会话」）默认是隐藏的，不会被误显示；MutationObserver 下一帧补标记。
   `html[data-dsc-filter="on"] [data-row-key^="session:"]:not([data-row-key="session:<id>"])…{display:none!important}`
   这样原生行的样式、分组、点击、右键菜单全部保持原样。
3. **展开折叠**：原生列表按工作区折叠（「展开其余 N 个会话」，一次只 +5，且 `watermark` 是组件内部 state、外部改不了）。所以筛选前先**连点**底部展开按钮（最多 60 轮），期间把列表 `visibility:hidden` 藏住闪烁；同一份筛选只做一次（`expandedSignature` 记忆）。

清单弹层的顺序可配（`settings.filterSort`）：`created`（默认，位置稳定）/ `activity`（分类内最新会话倒序、空分类沉底，与分类页一致）。**配置只影响这份清单**，分类页永远按活跃度。

**筛选命中集合只看 `assignments`**：分类筛选需要的是「哪些会话归这个分类」，而 `assignments` 在 `/hints` 里就有（0.6ms）。所以点分类是即时的，不需要等 `/state` 扫完全部会话（89 条会话冷调用 ≈1.85s，热缓存 1ms）。「未分类」是唯一例外——它要「没有归属的那些」，必须知道全部会话 id，得等会话清单加载完（加载完成后 store 变化会自动重算并套上筛选）。

同理，筛选清单**不会阻塞在 `/state` 上**：打开就立刻列出分类，条数先用归属表兜底（`·` 表示「会话清单还没到、这个数未知」），`/state` 回来之后自动换成准确值。

性能约束：`applySidebarFilter` 会被 store 的**每次**变化调用（提示轮询、busy、toast），所以它先算一个签名 `分类id|命中id列表`，签名没变就直接 return，不重写样式表。

### 4.5 输入框建议 chip + 待处理建议

同一份数据（`hints` / `titleHints`）的两个出口：

- **输入框 chip**（`conversation.input.left`）：当前会话有建议时出现，`[归入 ● 分类]` / `[标题建议 新标题]`，各带一个 `✕`。直接写进输入框工具行**在流内**，不浮动、不量坐标——位置永远不会跑。
- **待处理建议条**（面板顶部，默认收起）：把所有会话的建议按会话聚合成一行，`[归入 ● 分类 ▾]`（▾ 换分类）+ `[改名 新标题]` + 行尾「忽略」。两块 chip 各自独立采纳。

采纳 = `POST /hint`（或 `/title`）→ 写 `assignments` / 调 `sessionController.rename` → 删对应的 hint。忽略 = 写 `ignored` / `titleIgnored`，此后不再自动判断。

### 4.6 设置 / 调用记录

- 设置分四组（基础 / 判断依据 / 会话标题 / 花费统计），改完点保存，`POST /settings`。
- 调用记录是面板内的一个视图（不是弹窗）：顶部「当日/本周/本月 · N 次自动 · ¥x ／ M 次手动 · ¥y」，下面逐条明细。

---

## 5. 关键取舍（为什么这么做）

| 取舍 | 原因 |
| --- | --- |
| 状态独立存 `state.json`，不写会话日志 | 分类是元数据，不是会话内容；升级/回滚/换 profile 只影响这一个文件，也好备份 |
| 再叠一层 `CategoryStore`（tmp+rename、串行队列） | 自动分类和手动操作会并发写同一个文件，写坏一次就全丢 |
| 素材按「轮」聚合，只保留真人消息 | 注入的 system-reminder / 运行时快照占大头且带偏判断；按轮才拿得到「这一轮问什么、答了什么」 |
| 标题判断单独一套素材（整条会话摘要） | 只看最后一轮必然生成「执行完成」这类无效标题 |
| 节奏控制 + 次数上限 | 每轮都问一次模型是纯烧钱：没结论时模型不会留下任何痕迹，下一轮还会再问一遍。**分类**走「隔 3 轮再问 + 连空 5 次停」；**标题**只按用户设定的频率执行，不做暗改 |
| 提示放输入框工具行（流内），不放浮层 | 浮层要量锚点，锚点量不到就整块不渲染；流内元素位置天然正确 |
| 筛选用 CSS 隐藏原生行 + 连点展开 | 没有列表插槽；重排自己的列表会丢掉原生样式/分组/右键菜单 |
| 写操作只合并增量，不重拉 `/state` | `/state` 要为每条会话读日志折叠标题，几百条时 1~2 秒 |
| 子代理会话完全不进流程 | 面板上看不到，判断出来也没人看得见，纯浪费 |

---

## 6. 已知边界

- **折叠上限**：原生折叠每步只放 5 条（`watermark` 自动展开上限 50），超过只能连点；极端多会话时展开会多花几轮（外层已做隐藏，看不出闪烁）。
- **原生 DOM 注入**：依赖 `[data-row-key^="workspace:"]` / `[data-row-key^="session:"]` 这两个属性。DSH 换掉这两个标记，筛选入口和筛选都会失效（插件本身不会崩，其他功能照常）。
- **Host 半改动要重启 DSH**：本 profile 用 `link:` 挂载，host 代码不热更；Client 半改完刷新页面即可。
- **`costMeter` 不在时**：只统计 token，费用显示 0（不猜价格）。
- **prompt 有字数预算**：素材超过 `MATERIAL_CHAR_BUDGET = 12000` 字时从最新往回保留、丢掉最早的轮次并注明「更早的 N 轮已省略」；单条就超预算时仍保留那一条。
- **会话清单必须点开面板才加载**：不打开分类面板就不会扫会话清单（启动零全量 I/O）；代价是打不开面板时侧边栏筛选清单要先等一次全量加载。

---

## 7. 一次自动分类的完整时序

```
用户发消息 ──▶ 模型回复 ──▶ turn/end(completed)
                                 │
                    Host: scheduleAuto(sessionId, turn)   [800ms 去重]
                                 │
                    needsCategory?  ──否──┐
                    needsTitle?     ──否──┴──▶ 结束（不花钱）
                                 │是
                    readTitleSnapshot + buildSessionMaterial
                                 │
                    llm.stream(分类提示词 [+ 标题规则])   ← 一次调用
                                 │
                    parseSuggestionArray → sanitize（置信度过滤）
                                 │
                    store.mutate: usage+=、calls+=、hints=、titleHints=、节奏记录
                                 │
   Client: 20s 轮询 /hints ──▶ 输入框 chip 出现（当前会话）+ 面板「待处理建议 N」+1
                                 │
              用户点 [归入 ● 分类] ──▶ POST /hint(accept) ──▶ assignments 写入、hint 删除
              用户点 ✕            ──▶ POST /hint(dismiss) ─▶ ignored 写入，此后不再自动判断
```
