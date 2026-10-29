/**
 * dsh-session-categories — Client 半。
 *
 * 挂载点：
 *  - sidebar.panellist                        → 侧边栏「分类」入口图标
 *  - main (key: session-categories)           → 主区域分类页
 *  - sidebar.session.row.leading              → 原生会话行首的分类色点
 *  - sidebar.workspaces.session.row.action    → 原生会话行尾的「移动到分类」按钮
 *  - shell.overlay                            → 移动分类的对话框
 *  - conversation.composer.dock               → 输入框下方的自动分类提示条
 *
 * 所有数据都走 Host 的 /dsh-session-categories/api/* 路由，不依赖生成式 Remote。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-categories',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useMemo, useCallback, useSyncExternalStore, useRef } = React

    const PANEL_ID = 'session-categories'
    const API = '/dsh-session-categories/api'
    const NS = 'session-categories'
    /** 每个分类下默认先列多少条会话；再多就折叠，避免一屏滚不到底。 */
    const PAGE_SIZE = 10

    // ------------------------------------------------------------ 文案

    const zh = {
      'panel.title': '会话分类',
      'panel.subtitle': '把会话归入分类，或在分类下开一条新会话',
      'panel.newCategory': '新建分类',
      'panel.categoryNamePlaceholder': '分类名称，回车创建',
      'panel.uncategorized': '未分类',
      'panel.showAll': '展开全部 {n} 条',
      'panel.collapseList': '收起',
      'panel.expand': '展开',
      'search.placeholder': '搜索会话标题 / 分类 / 会话 id',
      'search.results': '{n} 条结果',
      'search.empty': '没有匹配「{q}」的会话',
      'search.clear': '清除',
      'panel.collapse': '收起',
      'panel.loading': '加载中…',
      'panel.rename': '重命名',
      'panel.delete': '删除',
      'panel.archive': '归档',
      'panel.archivedToast': '已归档「{name}」，点右上角归档图标可找回',
      'panel.unarchivedToast': '「{name}」已恢复到分类列表',
      'panel.unarchive': '恢复',
      'panel.archivedEntry': '查看已归档分类（{n}）',
      'archived.backToList': '返回分类',
      'archived.banner': '已归档分类（{n}）· 不参与新建会话和自动分类',
      'archived.empty': '还没有归档的分类',
      'panel.archivedEmpty': '还没有归档的分类',
      'menu.moveTo': '移到分类',
      'panel.deleteConfirm': '删除分类「{name}」？分类下的会话会回到「未分类」，不会被删除。',
      'panel.newSession': '在此分类下新建会话',
      'panel.workspace': '工作区',
      'error.http': '请求失败（{status}）',
      'err.host.notLoopback': '只接受本机访问',
      'err.host.crossOrigin': '跨站请求被拒绝',
      'err.host.contentType': '请求格式不正确',
      'err.method.postOnly': '该操作只支持 POST',
      'err.method.getOnly': '该操作只支持 GET',
      'err.body.invalidJson': '请求体不是合法的 JSON',
      'err.body.tooLarge': '请求体过大',
      'err.category.nameRequired': '分类名不能为空',
      'err.category.missingId': '缺少分类 id',
      'err.category.missingIdOrName': '缺少分类 id 或名称',
      'err.category.notFound': '分类不存在',
      'err.assign.missingItems': '缺少要修改的会话',
      'err.session.missingId': '缺少会话 id',
      'err.session.emptyMaterial': '这条会话还没有可判断的内容',
      'err.session.controllerUnavailable': '当前无法新建会话',
      'err.session.createNoId': '新建会话失败',
      'err.session.createFailed': '新建会话失败',
      'err.session.renameUnavailable': '当前无法改名',
      'err.session.renameFailed': '改名失败',
      'err.sessionQuery.unavailable': '读取会话列表的服务不可用',
      'err.hint.expired': '这条建议已经失效',
      'err.title.empty': '标题不能为空',
      'err.model.unavailable': '当前没有可用模型',
      'err.action.unknown': '未知操作',
      'panel.workspaceDefault': '跟随后端默认',
      'panel.untitled': '未命名会话',
      'panel.moveTo': '移动到',
      'panel.reload': '刷新',
      'panel.close': '关闭',
      'filter.title': '按分类筛选',
      'filter.all': '全部会话',
      'filter.clear': '清除筛选',
      'pending.title': '待处理建议',
      'pending.category': '归入',
      'pending.ignore': '忽略',
      'pending.pick': '选其他分类',
      'pending.rename': '改名',
      'pending.acceptCategory': '点击采纳：归入这个分类',
      'pending.acceptTitle': '点击采纳：改成这个标题',
      'pending.colSession': '会话',
      'pending.colSuggestion': '建议',
      'pending.expand': '展开其余 {n} 条',
      'pending.collapse': '收起',
      'calls.title': '调用记录',
      'calls.subtitle': '每一次模型调用：花在哪个会话、判断什么、有没有结果',
      'calls.empty': '还没有调用记录',
      'calls.open': '查看调用记录',
      'calls.clear': '清空',
      'calls.clearConfirm': '清空全部调用记录？（花费统计不受影响）',
      'calls.split': '{range}{autoCalls} 次自动 · {autoCost} ／ {manualCalls} 次手动 · {manualCost}',
      'calls.backlog': '明细从插件更新之后才开始逐条记录：更早的 {n} 次只计入上面的总额。',
      'calls.capped': '明细只保留最近 {n} 条，更早的调用只计入上面的总额。',
      'calls.scope.classify': '分类',
      'calls.scope.title': '标题',
      'calls.scope.both': '分类+标题',
      'calls.outcome.suggested': '有建议',
      'calls.outcome.none': '无结论',
      'calls.outcome.error': '失败',
      'calls.close': '关闭',
      'panel.usage': '自动分类调用 {calls} 次 · 输入 {input} / 输出 {output} tokens',
      'panel.usageEmpty': '自动分类还没有调用',
      'panel.cost': '≈ {cost}',
      'panel.saved': '已保存',
      'panel.back': '返回分类',
      'range.day': '当日',
      'range.week': '本周',
      'range.month': '本月',
      'settings.title': '设置',
      'settings.subtitle': '提示词、判断口径与花费统计都保存在本机',
      'settings.ai': 'AI 自动分类',
      'settings.aiHint': '每轮结束后判断一次',
      'settings.mark': '会话行显示分类标记',
      'settings.markHint': '关掉后侧边栏不显示分类色条',
      'settings.filterSort': '筛选清单排序',
      'settings.filterSortHint': '侧边栏清单的顺序；按活跃会随消息变动',
      'filterSort.created': '按创建',
      'filterSort.activity': '按活跃',
      'settings.group.basic': '基础',
      'settings.group.judge': '判断依据',
      'settings.group.title': '会话标题',
      'settings.group.cost': '花费统计',
      'settings.turns': '对话轮次',
      'settings.turnsHint': '每次判断时带上最近几轮对话；「全部」= 整条会话',
      'settings.off': '关闭',
      'settings.everyTurns': '每 {n} 轮',
      'scope.turns': '{n} 轮',
      'settings.titleCheck': '标题检查频率',
      'settings.titleCheckHint': '每 N 轮看一次标题：缺对象或具体操作就提示改名；0 = 关闭',
      'scope.all': '全部',

      'settings.costRange': '花费统计档位',
      'settings.confidence': '最低置信度',
      'settings.confidenceHint': '低于它的建议不提示（0 ~ 1）',
      'settings.save': '保存',
      'settings.cancel': '取消',
      'settings.dirty': '有未保存的修改',
      'dialog.title': '移动到分类',
      'dialog.uncategorized': '移出分类（未分类）',
      'dialog.cancel': '取消',
      'hint.chipLabel': '归入',
      'hint.text': '这条会话看起来属于「{name}」',
      'hint.dismiss': '忽略',
      'hint.titleLabel': '标题建议',
      'hint.dismissTitle': '不再提示标题',
      'menu.regenerateTitle': '重新生成标题',
      'title.title': '重新生成标题',
      'title.placeholder': '会话标题',
      'title.loading': '正在生成…',
      'title.noSuggestion': '模型认为当前标题已经够贴切；想改的话直接编辑下面的内容',
      'title.save': '保存',
      'title.cancel': '取消',
      'time.now': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'time.months': '{n} 个月前',
    }

    const en = {
      'panel.title': 'Session categories',
      'panel.subtitle': 'Group sessions into categories, or start a new one inside a category',
      'panel.newCategory': 'New category',
      'panel.categoryNamePlaceholder': 'Category name, press Enter',
      'panel.uncategorized': 'Uncategorized',
      'panel.showAll': 'Show all {n}',
      'panel.collapseList': 'Collapse',
      'panel.expand': 'Expand',
      'search.placeholder': 'Search titles, categories or session ids',
      'search.results': '{n} results',
      'search.empty': 'Nothing matches "{q}"',
      'search.clear': 'Clear',
      'panel.collapse': 'Collapse',
      'panel.loading': 'Loading…',
      'panel.rename': 'Rename',
      'panel.delete': 'Delete',
      'panel.archive': 'Archive',
      'panel.archivedToast': 'Archived "{name}" — find it under the archive icon',
      'panel.unarchivedToast': '"{name}" is back in the list',
      'panel.unarchive': 'Restore',
      'panel.archivedEntry': 'View archived categories ({n})',
      'archived.backToList': 'Back to categories',
      'archived.banner': 'Archived categories ({n}) · excluded from new sessions and auto-classify',
      'archived.empty': 'No archived categories yet',
      'panel.archivedEmpty': 'No archived categories yet',
      'menu.moveTo': 'Move to category',
      'panel.deleteConfirm': 'Delete category "{name}"? Its sessions move back to Uncategorized.',
      'panel.newSession': 'New session in this category',
      'panel.workspace': 'Workspace',
      'error.http': 'Request failed ({status})',
      'err.host.notLoopback': 'Only local access is allowed',
      'err.host.crossOrigin': 'Cross-site request blocked',
      'err.host.contentType': 'Unsupported request format',
      'err.method.postOnly': 'This action requires POST',
      'err.method.getOnly': 'This action requires GET',
      'err.body.invalidJson': 'Request body is not valid JSON',
      'err.body.tooLarge': 'Request body is too large',
      'err.category.nameRequired': 'Category name is required',
      'err.category.missingId': 'Missing category id',
      'err.category.missingIdOrName': 'Missing category id or name',
      'err.category.notFound': 'Category not found',
      'err.assign.missingItems': 'No sessions to update',
      'err.session.missingId': 'Missing session id',
      'err.session.emptyMaterial': 'This session has nothing to judge yet',
      'err.session.controllerUnavailable': 'Cannot create a session right now',
      'err.session.createNoId': 'Failed to create session',
      'err.session.createFailed': 'Failed to create session',
      'err.session.renameUnavailable': 'Cannot rename right now',
      'err.session.renameFailed': 'Failed to rename',
      'err.sessionQuery.unavailable': 'Session service unavailable',
      'err.hint.expired': 'This suggestion has expired',
      'err.title.empty': 'Title cannot be empty',
      'err.model.unavailable': 'No model available',
      'err.action.unknown': 'Unknown action',
      'panel.workspaceDefault': 'Backend default',
      'panel.untitled': 'Untitled session',
      'panel.moveTo': 'Move to',
      'panel.reload': 'Refresh',
      'panel.close': 'Close',
      'filter.title': 'Filter by category',
      'filter.all': 'All sessions',
      'filter.clear': 'Clear filter',
      'pending.title': 'Pending suggestions',
      'pending.category': 'Move to',
      'pending.ignore': 'Ignore',
      'pending.pick': 'Pick another category',
      'pending.rename': 'Rename',
      'pending.acceptCategory': 'Click to accept: move to this category',
      'pending.acceptTitle': 'Click to accept: rename to this',
      'pending.colSession': 'Session',
      'pending.colSuggestion': 'Suggestion',
      'pending.expand': 'Show {n} more',
      'pending.collapse': 'Collapse',
      'calls.title': 'Call log',
      'calls.subtitle': 'Every model call: which session, what was judged, and whether it produced anything',
      'calls.empty': 'No calls yet',
      'calls.open': 'View call log',
      'calls.clear': 'Clear',
      'calls.clearConfirm': 'Clear the whole call log? (Spending totals are unaffected)',
      'calls.split': '{range}: auto {autoCalls} · {autoCost} ／ manual {manualCalls} · {manualCost}',
      'calls.backlog': 'Per-call details are only recorded after this update; the earlier {n} calls are counted in the totals only.',
      'calls.capped': 'Only the latest {n} calls are kept; earlier ones are counted in the totals only.',
      'calls.scope.classify': 'Category',
      'calls.scope.title': 'Title',
      'calls.scope.both': 'Category+Title',
      'calls.outcome.suggested': 'Suggested',
      'calls.outcome.none': 'No result',
      'calls.outcome.error': 'Failed',
      'calls.close': 'Close',
      'panel.usage': 'Auto-classify: {calls} calls · {input} in / {output} out tokens',
      'panel.usageEmpty': 'No auto-classify calls yet',
      'panel.cost': '≈ {cost}',
      'panel.saved': 'Saved',
      'panel.back': 'Back',
      'range.day': 'Today',
      'range.week': 'This week',
      'range.month': 'This month',
      'settings.title': 'Settings',
      'settings.subtitle': 'Prompts, thresholds and cost stats are stored locally',
      'settings.ai': 'Auto-classify',
      'settings.aiHint': 'Judge once after each turn',
      'settings.mark': 'Show category mark in session rows',
      'settings.markHint': 'Hide the colour stripe in sidebar rows',
      'settings.filterSort': 'Filter list order',
      'settings.filterSortHint': 'Order inside the sidebar filter (not the panel); Active reorders as sessions update',
      'filterSort.created': 'Created',
      'filterSort.activity': 'Active',
      'settings.group.basic': 'Basics',
      'settings.group.judge': 'Judgement',
      'settings.group.title': 'Session title',
      'settings.group.cost': 'Cost',
      'settings.turns': 'Turns of context',
      'settings.turnsHint': 'How many recent turns go into every judgement; Whole means the entire session',
      'settings.off': 'Off',
      'settings.everyTurns': 'every {n} turns',
      'scope.turns': '{n} turns',
      'settings.titleCheck': 'Title check frequency',
      'settings.titleCheckHint': 'Every N turns, suggest a rename if the title lacks a concrete subject or the action; 0 = off',
      'scope.all': 'Whole',

      'settings.costRange': 'Cost range',
      'settings.confidence': 'Minimum confidence',
      'settings.confidenceHint': 'Suggestions below it stay hidden (0 ~ 1)',
      'settings.save': 'Save',
      'settings.cancel': 'Cancel',
      'settings.dirty': 'Unsaved changes',
      'dialog.title': 'Move to category',
      'dialog.uncategorized': 'Remove from category (Uncategorized)',
      'dialog.cancel': 'Cancel',
      'hint.chipLabel': 'Move to',
      'hint.text': 'This session looks like it belongs to "{name}"',
      'hint.dismiss': 'Ignore',
      'hint.titleLabel': 'Suggested title',
      'hint.dismissTitle': 'Never suggest a title',
      'menu.regenerateTitle': 'Regenerate title',
      'title.title': 'Regenerate title',
      'title.placeholder': 'Session title',
      'title.loading': 'Generating…',
      'title.noSuggestion': 'The model thinks the current title already fits — edit it below if you disagree',
      'title.save': 'Save',
      'title.cancel': 'Cancel',
      'time.now': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'time.months': '{n} mo ago',
    }

    // ------------------------------------------------------------ 样式

    const CSS = `
.dsc-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;padding:24px;z-index:1100;box-sizing:border-box}
/* 从分类弹窗里打开的面板（调用记录）：必须压过分类弹窗自己 */
.dsc-backdrop.dsc-backdrop-top{z-index:1300}
.dsc-dialog{position:relative;display:flex;flex-direction:column;width:840px;max-width:calc(100vw - 64px);height:min(82vh,780px);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:clip;color:var(--dsw-alias-label-primary);font-size:13px;box-sizing:border-box}
.dsc-progress{position:absolute;top:0;left:0;right:0;height:2px;overflow:hidden;z-index:6;pointer-events:none}
.dsc-progress::after{content:"";position:absolute;top:0;left:-45%;width:45%;height:100%;background:var(--dsw-alias-brand-primary);animation:dsc-progress 1s ease-in-out infinite}
@keyframes dsc-progress{0%{left:-45%}100%{left:100%}}
.dsc-dialog[data-busy="true"] .dsc-dialog-body{opacity:.55;pointer-events:none}
.dsc-dialog-body{transition:opacity .12s}
.dsc-panel{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;box-sizing:border-box}
.dsc-head{display:flex;align-items:flex-start;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.dsc-head h1{margin:0;font-size:15px;font-weight:600;line-height:22px}
.dsc-head p{margin:3px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsc-head-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dsc-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 28px}
.dsc-dialog-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 28px}
.dsc-dialog-body-flush{padding:0}
.dsc-body-pad{padding:14px 20px 28px}
.dsc-foot{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-l1);padding:7px 20px;font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px}
.dsc-foot-cost{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dsc-foot-link{border:0;background:transparent;padding:0;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}
.dsc-foot-link:hover{color:var(--dsw-alias-brand-primary)}
.dsc-btn{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-family:inherit}
.dsc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsc-btn:disabled{opacity:.5;cursor:default}
.dsc-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.dsc-btn.ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:0 6px}
.dsc-icon-btn{width:28px;height:28px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;font-family:inherit}
.dsc-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsc-icon-btn[data-on="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1)}
.dsc-btn.ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dsc-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none;border:0;background:transparent;font-family:inherit;padding:0}
.dsc-switch i{width:26px;height:15px;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;display:inline-block;transition:background .15s}
.dsc-switch i::after{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;transition:transform .15s}
.dsc-switch[data-on="true"] i{background:var(--dsw-alias-brand-primary)}
.dsc-switch[data-on="true"] i::after{transform:translateX(11px)}
.dsc-input{height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 8px;font-size:12px;font-family:inherit;outline:none;min-width:0}
.dsc-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsc-select{height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;padding:0 6px;max-width:220px}
/* 分类块：左侧一条分类色的「书脊」，标题做成粘性头，滚动时始终看得见当前分类 */
.dsc-cat{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsc-cat-color,var(--dsw-alias-border-l2));border-radius:12px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-1)}
/* 三栏栅格：左右各留 26px 对称占位，标题才能精确居中 */
.dsc-cat-head{display:grid;grid-template-columns:26px minmax(0,1fr) 26px;align-items:center;gap:6px;padding:0 10px;min-height:40px;position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-layer-1);border-radius:11px 11px 0 0}
/* 左右对称留白：给悬停操作留位置，长标题不会钻到按钮下面，且不影响居中 */
.dsc-cat-title{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;padding:0 92px}
.dsc-cat[data-open="true"]>.dsc-cat-head{border-bottom:1px solid var(--dsw-alias-border-l1);box-shadow:0 6px 12px -8px rgba(0,0,0,.35)}
.dsc-cat[data-open="false"]>.dsc-cat-head{border-radius:11px}
.dsc-cat-toggle{width:20px;height:20px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transform:rotate(0deg);transition:transform .12s;flex:0 0 auto}
.dsc-cat-toggle[data-collapsed="true"]{transform:rotate(-90deg)}
.dsc-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;display:inline-block}
.dsc-cat-name{font-weight:600;font-size:14px;line-height:20px;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsc-cat-count{flex:0 0 auto;min-width:20px;text-align:center;font-size:11px;font-weight:600;line-height:18px;padding:0 7px;border-radius:999px;color:var(--dsc-cat-color,var(--dsw-alias-label-secondary));background:var(--dsw-alias-bg-layer-2);font-variant-numeric:tabular-nums}
.dsc-cat[data-empty="true"] .dsc-cat-count{color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1)}
.dsc-cat[data-empty="true"]{border-left-color:var(--dsw-alias-border-l1)}
.dsc-cat[data-empty="true"] .dsc-cat-name{color:var(--dsw-alias-label-secondary)}
.dsc-cat[data-empty="true"]>.dsc-cat-head{min-height:34px}
.dsc-cat[data-empty="true"] .dsc-cat-toggle{visibility:hidden}
.dsc-cat-actions{position:absolute;right:10px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .12s;background:inherit;border-radius:8px}
.dsc-cat:hover .dsc-cat-actions,.dsc-cat:focus-within .dsc-cat-actions{opacity:1}
.dsc-rows{border-radius:0 0 11px 11px;overflow:hidden}
.dsc-more{display:block;width:100%;box-sizing:border-box;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;line-height:26px;text-align:center;cursor:pointer}
.dsc-more:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
/* 搜索框：标题 / 会话 id / 工作区 / 分类名都能搜 */
.dsc-search{display:flex;align-items:center;gap:8px;padding:10px 20px 0;flex:0 0 auto}
.dsc-search-box{display:flex;align-items:center;gap:7px;flex:1 1 auto;min-width:0;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.dsc-search-box:focus-within{border-color:var(--dsw-alias-brand-primary)}
.dsc-search-box input{flex:1 1 auto;min-width:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;line-height:18px;padding:0}
.dsc-search-box input::placeholder{color:var(--dsw-alias-label-secondary)}
.dsc-search-clear{flex:0 0 auto;width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit}
.dsc-search-clear:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsc-search-count{flex:0 0 auto;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsc-row-title mark{background:transparent;color:var(--dsw-alias-brand-primary);font-weight:600}
/* 顶部横向导航：分类多了不用一路滚，点一下跳到对应分类 */
.dsc-jump{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.dsc-jump button{display:inline-flex;align-items:center;gap:5px;height:25px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;font-family:inherit;flex:0 0 auto}
.dsc-jump button:hover{border-color:var(--dsc-cat-color,var(--dsw-alias-brand-primary))}
.dsc-jump button b{margin-left:1px;font-weight:600;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
/* 待处理建议：卡片在输入框那边，这里给一个「总目录」，免得挂着建议却找不到 */
.dsc-pending{flex:0 0 auto;border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px 20px 10px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1)}
.dsc-pending-head{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.dsc-pending-head b{color:var(--dsw-alias-brand-primary);font-weight:600}
/* 三列定宽：会话 / 建议 / 操作。列头与内容共用同一套列宽，才会上下对齐 */
.dsc-pending-cols,.dsc-pending-row{display:grid;grid-template-columns:minmax(0,1fr) 390px 68px;gap:10px;align-items:center;min-width:0}
.dsc-pending-cols{font-size:11px;color:var(--dsw-alias-label-secondary);padding:2px 0 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsc-pending-cols>span:last-child{text-align:right}
.dsc-pending-row{font-size:12px;line-height:24px;color:var(--dsw-alias-label-primary);padding:1px 0}
.dsc-pending-row:hover{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}
.dsc-pending-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-pending-sug{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0}
.dsc-pending-sug:empty{display:none}
.dsc-pending-slot{display:inline-flex;align-items:center;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-base)}
/* 每块建议自己就是「采纳」按钮：点哪块采纳哪块，互不影响 */
.dsc-sug-accept{display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;min-width:0;height:22px;padding:0 8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-family:inherit;cursor:pointer;border-radius:999px;white-space:nowrap}
.dsc-sug-accept>span{flex:0 1 auto}
.dsc-sug-accept:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsc-sug-accept:disabled{opacity:.5;cursor:default}
.dsc-sug-caret{width:18px;height:22px;border:0;border-left:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:9px;cursor:pointer;padding:0;font-family:inherit}
.dsc-sug-caret:hover:not(:disabled){color:var(--dsw-alias-brand-primary)}
.dsc-sug-caret:disabled{opacity:.5;cursor:default}
.dsc-pending-tag{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px;line-height:16px}
.dsc-pending-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsc-pending-actions{display:flex;align-items:center;justify-content:flex-end;gap:2px}
.dsc-mini-btn{height:22px;padding:0 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1;font-family:inherit;cursor:pointer}
.dsc-mini-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsc-mini-btn:disabled{opacity:.5;cursor:default}
.dsc-pending-target{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsc-pending-more{align-self:flex-start;border:0;background:transparent;padding:0;font:inherit;font-size:11px;color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsc-pending-toggle{height:26px;padding:0 10px;font-size:12px;gap:6px}
.dsc-pending-toggle b{font-weight:600;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.dsc-pending-toggle[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsc-pending-pick{border:0;background:transparent;padding:0 3px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:4px;max-width:180px}
.dsc-pending-pick:hover{background:var(--dsw-alias-bg-layer-2)}
.dsc-pending-caret{font-size:9px;color:var(--dsw-alias-label-secondary)}
/* 调用记录 */
.dsc-calls-view{display:flex;flex-direction:column;gap:8px;height:100%;min-height:0}
.dsc-calls-list{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:auto;margin:2px 0 4px}
.dsc-call{display:grid;grid-template-columns:74px minmax(0,1fr) 66px 56px 64px;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px}
.dsc-call:first-child{border-top:0}
.dsc-call-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:11px}
.dsc-call-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsc-call-scope,.dsc-call-outcome{color:var(--dsw-alias-label-secondary);font-size:11px}
.dsc-call-outcome[data-on="suggested"]{color:var(--dsw-alias-state-success-primary)}
.dsc-call-cost{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dsc-calls-foot{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsc-calls-note{font-size:11px;color:var(--dsw-alias-label-secondary);padding:2px 0 6px}
/* 侧边栏按分类筛选 */
/* 侧边栏底部的条目要和原生那排「设置 / 用量」长得一样：无边框、无胶囊底、整行可点 */
.dsc-filter-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;font-family:inherit;box-sizing:border-box}
/* 悬停底色直接用原生会话行那一个 token（#2631480f 之类的半透明冷灰），
   自己用 color-mix 调出来的会偏暖/偏深，跟旁边的行对不上 */
.dsc-filter-btn:hover{background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent));color:var(--dsw-alias-label-primary)}
.dsc-filter-btn-wide{width:100%;height:30px;padding:0 6px;justify-content:flex-start;font-size:13px;background:transparent;border:0;border-radius:7px}
.dsc-filter-btn-wide[data-on="true"]{color:var(--dsw-alias-label-primary);font-weight:500}
/* 这一行要和侧边栏原生条目长得一样：透明底、无边框、悬停才有底色。
   它默认插在滚动容器**外面**（见 mountSidebarFilterBar），所以不需要任何背景色；
   只有拿不到外层容器、退回粘在列表里时才加 sticky + 模糊（data-dsc-mode="inside"）。 */
#dsh-session-categories-filter-bar{margin:0;padding:2px 0 4px;flex:0 0 auto;display:flex;align-items:center;gap:2px;background:transparent}
#dsh-session-categories-filter-bar[data-dsc-mode="inside"]{position:sticky;top:0;z-index:3;backdrop-filter:blur(14px) saturate(1.1);-webkit-backdrop-filter:blur(14px) saturate(1.1)}
#dsh-session-categories-filter-bar .dsc-filter-btn-wide{flex:1 1 auto;min-width:0}
.dsc-filter-clearx{flex:0 0 auto;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-family:inherit;cursor:pointer;padding:0;box-sizing:border-box}
.dsc-filter-clearx:hover{background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent));color:var(--dsw-alias-label-primary)}
.dsc-filter-clearx[hidden]{display:none}

.dsc-filter-icon{flex:0 0 auto;display:inline-flex}
.dsc-filter-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dsc-filter-btn[data-on="true"]{background:transparent;color:var(--dsw-alias-label-primary)}
.dsc-filter-btn[data-on="true"]:hover{background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent))}
.dsc-filter-layer{position:fixed;inset:0;z-index:1250}
.dsc-filter-pop{position:fixed;left:0;top:0;width:252px;max-height:62vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:8px;box-sizing:border-box}
.dsc-filter-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 8px 8px;font-size:12.5px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsc-filter-clear{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12.5px;font-family:inherit;cursor:pointer;padding:0}
.dsc-filter-list{display:flex;flex-direction:column;overflow:auto;padding:6px 0 0}
.dsc-filter-row{display:flex;align-items:center;gap:9px;height:32px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;cursor:pointer;text-align:left}
/* 不要在浮层里用 bg-layer-* 当悬停色：这套主题的浮层底是蓝灰（约 #E9ECF2），
   而 layer-2 是纯白，两者叠在一起就是一条突兀的白杠。
   统一用主题的交互色（半透明冷灰），悬停 6%、选中 10%，靠透明度区分而不是靠换色系。 */
.dsc-filter-row:hover{background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, #263148 6%, transparent))}
.dsc-filter-row[data-on="true"]{
  background:var(--dsw-alias-interactive-bg-active, color-mix(in srgb, #263148 10%, transparent));
  color:var(--dsw-alias-brand-primary);
}
.dsc-filter-row[data-on="true"]:hover{
  background:var(--dsw-alias-interactive-bg-hover-accent, color-mix(in srgb, #263148 14%, transparent));
}
.dsc-filter-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-filter-count{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsc-row-wrap{display:contents}
.dsc-row{display:flex;align-items:center;gap:8px;padding:4px 12px;border-top:1px solid var(--dsw-alias-border-l1);min-height:28px;line-height:18px;transition:background .12s ease;cursor:pointer}
.dsc-row:first-child{border-top:0}
.dsc-row:hover{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}
.dsc-row:hover .dsc-row-title{color:var(--dsw-alias-label-primary)}
.dsc-row:hover .dsc-row-meta,.dsc-row:hover .dsc-row-ws{color:var(--dsw-alias-label-primary)}
.dsc-row-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:18px}
.dsc-row-meta{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsc-row-ws{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;line-height:16px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 12px 10px 30px}
.dsc-chip{font-size:11px;line-height:18px;padding:1px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px}
.dsc-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsc-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:transparent}
/* 会话清单还没到时先画一排骨架：冷调用要 1~2 秒，空着一个「加载中」比骨架更慌 */
.dsc-skel{padding:10px 20px 20px}
.dsc-skel-cat{margin-top:14px}
.dsc-skel-line{height:12px;border-radius:6px;margin:8px 0;background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);animation:dsc-skel-pulse 1.4s ease-in-out infinite}
.dsc-skel-line.w40{width:40%;height:14px}
.dsc-skel-line.w80{width:80%}
.dsc-skel-line.w60{width:60%}
.dsc-skel-note{font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0 4px}
@keyframes dsc-skel-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.dsc-skel-line{animation:none}}
.dsc-empty{padding:9px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsc-preview{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
.dsc-preview-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.dsc-preview-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto;margin-bottom:8px}
.dsc-preview-item{display:flex;align-items:center;gap:8px;font-size:12px}
.dsc-preview-item span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-preview-actions{display:flex;gap:8px;justify-content:flex-end}
.dsc-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 12px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.16);z-index:1300;pointer-events:none}
.dsc-menu-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;font-family:inherit;text-align:left;border-radius:6px;cursor:pointer}
.dsc-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dsc-menu-item svg{flex:0 0 auto;opacity:.75}
.dsc-archived-banner{display:flex;align-items:center;gap:10px;padding:9px 12px;margin-bottom:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsc-archived-banner>span{flex:1 1 auto;min-width:0}
.dsc-cat[data-archived="true"]{opacity:.75}
.dsc-mark{width:16px;height:16px;display:flex;align-items:center;justify-content:center}
/* 竖条而不是圆点：原生「有新回复」是 6px 圆点，圆点会和它撞脸 */
.dsc-mark i{width:3px;height:11px;border-radius:2px;display:block}
.dsc-action{width:22px;height:22px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.dsc-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsc-overlay{position:fixed;inset:0;background:transparent;z-index:1200;pointer-events:auto}
.dsc-modal{width:340px;max-width:calc(100vw - 32px);box-sizing:border-box;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:14px}
.dsc-modal-anchored{position:fixed;max-height:calc(100vh - 24px);overflow:auto}
.dsc-modal-center{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:400px;padding:16px}
.dsc-modal-center h2{margin-bottom:4px}
.dsc-modal-center .dsc-empty{padding:6px 0}
.dsc-modal h2{margin:0 0 10px;font-size:13px;font-weight:600}
.dsc-modal-list{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto}
.dsc-modal-item{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer}
.dsc-modal-item:hover{background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, #263148 6%, transparent))}
.dsc-modal-actions{display:flex;justify-content:flex-end;margin-top:10px}
/* 输入框工具行里的建议 chip：跟在「+ / 权限」后面，不浮动 */
.dsc-sug-row{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
/* 标签 / 正文 / ✕ 三块各自把文字居中在自己的盒子内，再由 align-items:center 对齐中轴。
   之前用 flex-start + 各自的 line-height/padding-top 凑，字号不同就会差 1~2px。 */
.dsc-sug{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:2px 4px 2px 8px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;max-width:min(420px,58vw)}
.dsc-sug-label{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;flex:0 0 auto;white-space:nowrap}
/* inline-flex 是为了让 gap 生效：inline-block 下圆点和分类名之间没有任何间距，只靠字形左边距，看起来贴在一起 */
.dsc-sug-btn{display:inline-flex;align-items:center;gap:6px;min-height:20px;padding:0 7px;border:0;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:20px;font-family:inherit;cursor:pointer;text-align:left;white-space:normal}
.dsc-sug-text{min-width:0;overflow-wrap:anywhere}
.dsc-sug-btn:hover:not(:disabled){background:var(--dsw-alias-brand-primary);color:#fff}
.dsc-sug-btn:disabled{opacity:.5;cursor:default}
.dsc-sug-x{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;cursor:pointer;padding:0;font-family:inherit}
.dsc-sug-x:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsc-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1;cursor:pointer;font-family:inherit;max-width:190px;white-space:nowrap;overflow:hidden}
.dsc-pill:hover{border-color:var(--dsw-alias-brand-primary)}
.dsc-pill span{overflow:hidden;text-overflow:ellipsis}
.dsc-pill-open{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 6px 0 9px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);font-size:11.5px;color:var(--dsw-alias-label-primary);max-width:220px;white-space:nowrap}
.dsc-pill-open>span{overflow:hidden;text-overflow:ellipsis;min-width:0}
.dsc-pill-open button{height:20px;padding:0 7px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:11px;cursor:pointer;font-family:inherit;flex:0 0 auto}
.dsc-pill-open button.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.dsc-pill-open button:disabled{opacity:.5;cursor:default}
.dsc-settings{display:flex;flex-direction:column;gap:20px;padding:2px 2px 6px}
.dsc-section{display:flex;flex-direction:column;gap:10px}
.dsc-section>h3{margin:0;padding:0 0 7px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}
.dsc-field{display:flex;flex-direction:column;gap:5px}
.dsc-field-row{display:flex;align-items:center;gap:12px;padding:1px 0}
.dsc-field-row>label{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsc-field label{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsc-field-hint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}
.dsc-num{width:84px;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 8px;font-size:12px;font-family:inherit;outline:none;text-align:right}
.dsc-settings-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.dsc-settings-actions .dsc-field-hint{margin-right:auto}
.dsc-seg{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px;margin-left:auto;flex:0 0 auto}
.dsc-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:16px;padding:1px 7px;border-radius:999px;cursor:pointer;font-family:inherit}
.dsc-seg button:hover{color:var(--dsw-alias-label-primary)}
.dsc-seg button[data-on="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsc-slider{display:flex;align-items:center;gap:8px}
.dsc-range{width:110px;height:20px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsc-range:disabled{opacity:.4;cursor:default}
.dsc-slider-value{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:52px;text-align:right;font-variant-numeric:tabular-nums}
.dsc-scope-all{height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-family:inherit;cursor:pointer}
.dsc-scope-all:hover{color:var(--dsw-alias-label-primary)}
.dsc-scope-all[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsc-num:disabled{opacity:.45}
/* 会话行悬浮卡：DSH 把卡片底色写死成深色（--dsw-hovercard-bg:#2C2C2E），
   卡内文字若跟着主题取 label 色，浅色主题下就是深字压深底 —— 看不见。
   所以这里按卡片的固定深色配浅字，两套主题下都清楚。 */
.dsc-hover-cat{display:flex;align-items:center;gap:7px;font-size:12px;line-height:20px;color:#fff;opacity:.92}
`

    // ------------------------------------------------------------ 数据层

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    const store = createStore({
      phase: 'idle',
      error: '',
      data: null,
      hints: {},
      titleHints: {},
      hintCategories: [],
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
      dataAt: 0,
    })

    let stateInflight = null
    let hintsInflight = null

    async function request(path, init) {
      const response = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const t = store.get().__t
        // 宿主把错误码带回来了：按码翻译（英文界面不该弹中文报错）；
        // 没有码（例如服务层直接给的文本）就退回原文。
        const codeKey = payload?.code ? `err.${payload.code}` : ''
        const translated = t && codeKey ? t(codeKey) : ''
        const message =
          translated && translated !== codeKey
            ? translated
            : payload?.error || (t ? t('error.http', { status: response.status }) : `HTTP ${response.status}`)
        throw new Error(message)
      }
      return payload
    }

    function toast(message) {
      store.set({ toast: message })
      setTimeout(() => {
        if (store.get().toast === message) store.set({ toast: '' })
      }, 2600)
    }

    /**
     * 全量状态（含**会话清单**）。
     *
     * 这一个是贵的：Host 侧要为每条会话读标题，没标题的还要读首条消息（近百条 1~2 秒）。
     * 所以页面启动时**不调它**，只有真正要用会话清单的地方才调：
     * 打开分类面板、打开筛选清单。行首色标只需要 categories + assignments，/hints 就够。
     */
    /** 预热会话清单：已经热了就什么都不做，失败也不打扰用户。 */
    let warming = false
    function warmSessionList() {
      if (warming) return
      if (store.get().data?.sessionsLoaded === true) return
      warming = true
      refreshState().finally(() => {
        warming = false
      })
    }

    async function refreshState() {
      if (stateInflight) return stateInflight
      stateInflight = (async () => {
        if (!store.get().data) store.set({ phase: 'loading' })
        try {
          const data = { ...(await request('/state')), sessionsLoaded: true }
          store.set({
            phase: 'ready',
            error: '',
            data,
            dataAt: Date.now(),
            hints: data.hints ?? {},
            titleHints: data.titleHints ?? {},
            hintCategories: (data.categories ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color })),
          })
        } catch (error) {
          store.set({ phase: 'error', error: error.message })
        } finally {
          stateInflight = null
        }
      })()
      return stateInflight
    }

    /**
     * 轻量轮询：提示 + 分类 + 归属 + 设置（`/hints` 就返回这些，不扫会话清单）。
     *
     * 启动时先跑这个：行首色标、悬停卡片、筛选入口的文案都只需要这些字段，
     * 用一份「没有会话清单」的 lite data 撑住界面，等打开面板再补全量。
     */
    async function refreshHints() {
      if (hintsInflight) return hintsInflight
      hintsInflight = (async () => {
        try {
          const data = await request('/hints')
          const current = store.get().data
          const patch = {
            hints: data.hints ?? {},
            titleHints: data.titleHints ?? {},
            hintCategories: data.categories ?? [],
          }
          // 内容没变就别 set：store 每次 set 都会让所有订阅者重渲染，
          // 20 秒一次的空转在会话多的时候是真能感觉到的。
          const prev = store.get()
          const unchanged =
            current?.sessionsLoaded === true &&
            JSON.stringify(prev.hints) === JSON.stringify(patch.hints) &&
            JSON.stringify(prev.titleHints) === JSON.stringify(patch.titleHints)
          if (unchanged) {
            hintsInflight = null
            return
          }
          // 还没拿到过全量状态：用这次的分类/归属/设置先撑起来（sessionsLoaded = false）
          if (!current?.sessionsLoaded) {
            patch.data = {
              ...(current ?? {}),
              categories: data.categories ?? [],
              assignments: data.assignments ?? {},
              settings: data.settings ?? {},
              sessions: current?.sessions ?? [],
              sessionsLoaded: false,
              usage: current?.usage ?? null,
            }
            patch.phase = 'ready'
          }
          store.set(patch)
        } catch {
          /* 提示轮询失败不打扰用户 */
        } finally {
          hintsInflight = null
        }
      })()
      return hintsInflight
    }

    async function mutate(path, body) {
      try {
        const data = await request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
        return data
      } catch (error) {
        toast(error.message)
        return null
      }
    }

    /**
     * 把写操作的响应合并进当前 data，而不是整份重拉 /state。
     *
     * /state 要折叠全部会话标题（几百条时 1~2 秒），而分类增删改根本不改变会话清单；
     * 重拉只会让每次点删除都卡两秒。
     */
    function applyState(result) {
      if (!result) return false
      const current = store.get().data
      if (!current) {
        refreshState()
        return false
      }
      const next = { ...current }
      for (const key of ['categories', 'assignments', 'hints', 'ignored', 'settings']) {
        if (result[key] !== undefined) next[key] = result[key]
      }
      const patch = { data: next }
      if (result.hints !== undefined) patch.hints = result.hints
      if (Array.isArray(result.categories)) {
        patch.hintCategories = result.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))
      }
      store.set(patch)
      return true
    }

    /** 标记一个主题级忙碌状态，驱动顶部进度条与按钮禁用。 */
    async function withBusy(key, task) {
      store.set({ busy: key })
      try {
        return await task()
      } finally {
        store.set({ busy: '' })
      }
    }

    async function assign(sessionId, categoryId) {
      // 先乐观更新，网络往返期间界面不闪；失败（mutate 返回 null）时把原值放回去，
      // 否则界面会一直停在「已经移过去了」的假状态，直到下次刷新才发现没生效。
      const snapshot = store.get()
      const data = snapshot.data
      if (data) {
        const assignments = { ...data.assignments }
        if (categoryId) assignments[sessionId] = categoryId
        else delete assignments[sessionId]
        const hints = { ...snapshot.hints }
        delete hints[sessionId]
        store.set({ data: { ...data, assignments }, hints })
      }
      const result = await mutate('/assign', { items: [{ sessionId, categoryId: categoryId || null }] })
      if (result) applyState(result)
      else if (data) store.set({ data: { ...store.get().data, assignments: data.assignments }, hints: snapshot.hints })
    }

    function categoryOf(data, sessionsById, sessionId) {
      const categoryId = data?.assignments?.[sessionId]
      if (!categoryId) return undefined
      return data.categories.find((c) => c.id === categoryId)
    }

    function timeAgo(t, timestamp) {
      const diff = Date.now() - timestamp
      if (!Number.isFinite(diff) || diff < 0) return ''
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return t('time.now')
      if (minutes < 60) return t('time.minutes', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('time.hours', { n: hours })
      const days = Math.floor(hours / 24)
      if (days < 30) return t('time.days', { n: days })
      return t('time.months', { n: Math.floor(days / 30) })
    }

    // ------------------------------------------------------------ 图标

    // ------------------------------------------------------------ 侧边栏按分类筛选

    /** 漏斗图标：侧边栏底部的「按分类筛选」入口。 */
    function FilterIcon({ size = 18 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4 5h16l-6.5 7.5V19l-3 1.5v-8z' }),
      )
    }

    /** 当前分类下应该显示的会话 id（未分类 = 没有归属的那些）。 */
    /** 侧边栏里那一行（含筛选结果列表）的容器 id。 */
    const FILTER_BAR_ID = 'dsh-session-categories-filter-bar'

    /** 入口按钮上显示什么：没筛选显示「按分类筛选」，筛选中显示分类名 + 分类色点。 */
    function filterBarLabel(state) {
      const t = state.__t
      const categoryId = state.filterCategory
      if (!categoryId) return { text: t('filter.title'), color: '' }
      if (categoryId === '__uncategorized') return { text: t('panel.uncategorized'), color: '' }
      const category = (state.data?.categories ?? []).find((item) => item.id === categoryId)
      return { text: category?.name ?? t('filter.title'), color: category?.color ?? '' }
    }

    function paintFilterBar(bar) {
      const state = store.get()
      const t = state.__t
      const { text, color } = filterBarLabel(state)
      // store 每次变化都会走到这里；内容没变就别动 DOM（避免无谓的重排）
      const nextSignature = `${text}|${color}|${state.filterCategory ? 'on' : 'off'}`
      if (bar.dataset.dscLabel === nextSignature) return
      bar.dataset.dscLabel = nextSignature
      bar.setAttribute('data-on', state.filterCategory ? 'true' : 'false')
      bar.setAttribute('title', t('filter.title'))
      const clear = bar.parentElement?.querySelector('.dsc-filter-clearx')
      if (clear) {
        clear.hidden = !state.filterCategory
        clear.setAttribute('title', t('filter.clear'))
        clear.setAttribute('aria-label', t('filter.clear'))
      }
      const label = bar.querySelector('.dsc-filter-label')
      if (!label) return
      label.textContent = ''
      if (color) {
        const dot = document.createElement('i')
        dot.className = 'dsc-dot'
        dot.style.cssText = `background:${color};width:6px;height:6px;margin-right:5px`
        label.appendChild(dot)
      }
      label.appendChild(document.createTextNode(text))
    }

    /** 「工作区」分区的顶层节点：往上走到滚动容器为止，插在它前面就落在分区标题上方。 */
    function findWorkspacesSection() {
      // 先找工作区行；没有工作区时退到第一条会话行，落点仍然是列表上方
      const row =
        document.querySelector('[data-row-key^="workspace:"]') ??
        document.querySelector('[data-row-key^="session:"]')
      if (!row) return null
      let node = row
      for (let depth = 0; depth < 12; depth += 1) {
        const parent = node.parentElement
        if (!parent) return null
        const style = window.getComputedStyle(parent)
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node
        node = parent
      }
      return null
    }

    /** 当前筛选下应该显示的会话 id（未分类 = 没有归属的那些）。 */
    /**
     * 当前筛选要显示的会话 id。
     *
     * 分类筛选只需要「归属」，而 `assignments` 在 `/hints` 里就有（0.6ms 返回），
     * 所以点分类是**即时**生效的，不用等扫全部会话的 `/state`（冷调用近 2 秒）。
     * `assignments` 里可能留着已删除会话的 id，那只是多一条 `:not()`，匹配不到行，无害。
     *
     * 「未分类」正好相反：它要的是「没有归属的那些」，必须知道**全部**会话 id，
     * 只能等会话清单加载完（加载完成后 store 变化会自动重算并套上筛选）。
     */
    function filteredIds(state) {
      const data = state.data
      const categoryId = state.filterCategory
      if (!data || !categoryId) return null
      const assignments = data.assignments ?? {}
      if (categoryId === '__uncategorized') {
        if (data.sessionsLoaded !== true) return null
        return new Set((data.sessions ?? []).filter((item) => !assignments[item.id]).map((item) => item.id))
      }
      const ids = new Set()
      for (const [sessionId, assignedId] of Object.entries(assignments)) {
        if (assignedId === categoryId) ids.add(sessionId)
      }
      return ids
    }

    /**
     * 把筛选落到**原生列表**上，保持原生样式与分组。
     *
     * 原生列表按工作区分页折叠（「展开其余 N 个会话」，点一次 +5），
     * 只藏行是不够的：没渲染的会话藏无可藏，那个「其余 N 个」也还是按全量算。
     * 所以先把折叠全部点开（点到底按钮自己就消失了），再只藏不匹配的行。
     */
    let filterClicking = false

    /** 会话列表所在的滚动容器：把「展开」按钮的搜索范围限制在这里，别误点聊天区的同类按钮。 */
    function sessionListRoot() {
      const row = document.querySelector('[data-row-key^="session:"]')
      if (!row) return null
      let node = row
      for (let depth = 0; depth < 12; depth += 1) {
        const parent = node.parentElement
        if (!parent) return null
        const style = window.getComputedStyle(parent)
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return parent
        node = parent
      }
      return document.body
    }

    function findExpandButton(root) {
      if (!root) return null
      return [...root.querySelectorAll('button, [role="button"]')].find((node) => {
        const text = (node.textContent || '').trim()
        return (
          text.length > 0 &&
          text.length < 24 &&
          /\d/.test(text) &&
          // 这是原生「展开其余 N 个会话」按钮：DSH 有多套语言包，别只认中英文
          /(展开|收起|Show|more|Expand|weitere|mehr|afficher|plus|mostrar|más|もっと|表示|펼치|더 보기)/i.test(text)
        )
      })
    }

    /**
     * 一次点开所有「展开其余 N 个会话」。
     *
     * 原生每次只 +5（`SESSION_WATERMARK_BASE`），而且 watermark 是组件内部 state，
     * 外部改不了 —— 所以只能连点。用户不该看见这十几次闪烁：展开期间先把列表
     * 设成 `visibility:hidden`，点完再显示，观感上就是「一次全部展开」。
     * 展开后 watermark 在本次会话里一直保留，后续筛选不会再点。
     */
    let expandedSignature = ''
    function expandAllSessions(signature) {
      if (filterClicking) return
      // 同一份筛选已经展开过：不再重复扫描侧边栏
      if (signature && signature === expandedSignature) return
      const root = sessionListRoot()
      if (!root || !findExpandButton(root)) {
        expandedSignature = signature ?? ''
        return
      }
      filterClicking = true
      const previousVisibility = root.style.visibility
      root.style.visibility = 'hidden'
      let rounds = 0
      const finish = (done) => {
        root.style.visibility = previousVisibility
        filterClicking = false
        // 只有真的点到底（按钮消失）才记住，否则下次筛选还要继续展开剩下的
        if (done) expandedSignature = signature ?? ''
      }
      const step = () => {
        try {
          rounds += 1
          const button = rounds > 60 ? null : findExpandButton(root)
          if (!button) {
            finish(rounds <= 60)
            return
          }
          button.click()
          setTimeout(step, 0)
        } catch {
          finish(false)
        }
      }
      step()
    }

    /**
     * 应用/撤销筛选。
     *
     * store 每次变化都会调用这里（提示轮询、busy、toast…），所以必须便宜：
     * 只有「分类或命中集合」真的变了才重写样式表，否则直接返回。
     */
    /**
     * 筛选的落地方式：**默认隐藏 + 给命中行打标记**，一条规则、每次 O(行数)。
     *
     * 早先是按允许展示的会话 id 生成 N 个 `:not([data-row-key="session:x"])`，
     * 浏览器要拿每一个会话行去依次匹配这 N 个选择器 —— 2000 条会话就是约 400 万次
     * 属性比较，切一次筛选肉眼可见地卡。现在规则固定成一条，判定成本跟会话数线性相关。
     *
     * 用「默认隐藏」而不是「默认显示 + 隐藏不匹配的」，是因为 React 重渲染出新行时
     * 它天然是没有标记的 —— 直接隐藏，不会出现「先显示再消失」的闪烁。
     */
    const ALLOW_ATTR = 'data-dsc-allow'
    const FILTER_STYLE_ID = 'dsh-session-categories-filter'
    const FILTER_RULE = `html[data-dsc-filter="on"] [data-row-key^="session:"]:not([${ALLOW_ATTR}]){display:none !important}`

    /** 当前命中集合（null = 没有筛选）。 */
    let allowedIds = null
    let markQueued = false
    let filterObserver = null

    function markSessionRows() {
      const rows = document.querySelectorAll('[data-row-key^="session:"]')
      for (const row of rows) {
        const key = row.getAttribute('data-row-key') ?? ''
        const id = key.slice('session:'.length)
        const hit = allowedIds !== null && allowedIds.has(id)
        if (hit) {
          if (!row.hasAttribute(ALLOW_ATTR)) row.setAttribute(ALLOW_ATTR, '')
        } else if (row.hasAttribute(ALLOW_ATTR)) {
          row.removeAttribute(ALLOW_ATTR)
        }
      }
    }

    /** 合并同一帧内的多次标记请求（展开列表时会连续插入很多行）。 */
    function scheduleMark() {
      if (markQueued) return
      markQueued = true
      const run = () => {
        markQueued = false
        try {
          markSessionRows()
        } catch {
          /* 行被 React 换掉的瞬间查不到也无所谓，下一帧还会再来 */
        }
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }

    /**
     * 盯着列表容器：原生列表会懒渲染（「展开其余 N 个会话」），
     * 新冒出来的行必须在下一帧被补上标记，否则它们会被「默认隐藏」误伤。
     */
    let filterObserverRoot = null
    function ensureFilterObserver() {
      if (typeof MutationObserver !== 'function') return
      const root = sessionListRoot()
      if (!root) return
      // 容器被 React 换掉后，旧 observer 盯的是一个已经脱离文档的节点：
      // 之后新渲染的行永远不会被标记，而「默认隐藏」会让筛选后一条都不显示。
      // 所以这里每次都核对一遍目标，换了就重挂。
      if (filterObserver && filterObserverRoot === root && root.isConnected !== false) return
      if (filterObserver) filterObserver.disconnect()
      filterObserver = new MutationObserver(scheduleMark)
      filterObserver.observe(root, { childList: true, subtree: true })
      filterObserverRoot = root
      // 挂上之后立刻补一轮标记，别等下一次 DOM 变化
      scheduleMark()
    }

    function clearFilter() {
      allowedIds = null
      document.documentElement.removeAttribute('data-dsc-filter')
      if (filterObserver) {
        filterObserver.disconnect()
        filterObserver = null
      }
      filterObserverRoot = null
      for (const row of document.querySelectorAll(`[${ALLOW_ATTR}]`)) row.removeAttribute(ALLOW_ATTR)
    }

    let lastFilterSignature = ''
    function applySidebarFilter(state) {
      const ids = filteredIds(state)

      if (!ids) {
        if (lastFilterSignature === '') return
        lastFilterSignature = ''
        clearFilter()
        return
      }

      const signature = `${state.filterCategory}|${[...ids].join(',')}`
      if (signature === lastFilterSignature) return
      lastFilterSignature = signature

      // 规则表只写一次（内容固定），后面全靠行上的标记
      let style = document.getElementById(FILTER_STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = FILTER_STYLE_ID
        style.setAttribute('data-dsh-session-categories', '')
        document.head.appendChild(style)
      }
      if (style.textContent !== FILTER_RULE) style.textContent = FILTER_RULE

      // 先打标记再打开开关：顺序反了会看到整列先消失再回来
      allowedIds = ids
      markSessionRows()
      document.documentElement.setAttribute('data-dsc-filter', 'on')
      ensureFilterObserver()

      // 把所有会话都渲染出来，否则被折叠的匹配会话永远看不到
      expandAllSessions(signature)
      scheduleMark()
    }

    /** 只负责插一行入口；原生列表的筛选由 applySidebarFilter 处理。 */
    function mountSidebarFilterBar() {
      const create = () => {
        const wrap = document.createElement('div')
        wrap.id = FILTER_BAR_ID
        wrap.className = 'dsc-filter-wrap'
        wrap.setAttribute('data-dsh-session-categories', '')

        const bar = document.createElement('button')
        bar.type = 'button'
        bar.className = 'dsc-filter-btn dsc-filter-btn-wide'
        const icon = document.createElement('span')
        icon.className = 'dsc-filter-icon'
        icon.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8z"/></svg>'
        const label = document.createElement('span')
        label.className = 'dsc-filter-label'
        bar.appendChild(icon)
        bar.appendChild(label)
        bar.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const rect = bar.getBoundingClientRect()
          // 右缘取整行的（不是按钮的）：按钮右边还有 ✕，按按钮算会把弹层压在 ✕ 上
          const rowRect = bar.parentElement ? bar.parentElement.getBoundingClientRect() : rect
          const open = !store.get().filterOpen
          store.set({
            filterOpen: open,
            filterAnchor: { x: rect.left, y: rect.top, right: rowRect.right, bottom: rect.bottom },
          })
          if (open) refreshState()
        })
        const clear = document.createElement('button')
        clear.type = 'button'
        clear.className = 'dsc-filter-clearx'
        clear.textContent = '✕'
        clear.hidden = true
        clear.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          store.set({ filterCategory: '', filterOpen: false })
        })
        wrap.appendChild(bar)
        wrap.appendChild(clear)
        return wrap
      }

      const ensure = () => {
        let wrap = document.getElementById(FILTER_BAR_ID)
        if (!wrap) {
          const section = findWorkspacesSection()
          if (!section || !section.parentElement) return
          const scroller = section.parentElement
          const host = scroller.parentElement
          wrap = create()
          if (host) {
            // 优先插在滚动容器**外面**：这样它不随列表滚动，也永远不会盖住会话行，
            // 于是背景可以完全透明 —— 天然跟侧边栏同色（侧边栏是半透明 + 壁纸，
            // 任何写死的底色都会露出色差带）。
            wrap.dataset.dscMode = 'outside'
            // 横向内边距抄滚动容器的，才能和列表里的「工作区」标题左对齐
            const style = window.getComputedStyle(scroller)
            wrap.style.paddingLeft = style.paddingLeft
            wrap.style.paddingRight = style.paddingRight
            host.insertBefore(wrap, scroller)
          } else {
            // 兜底：拿不到外层容器就仍然塞进列表里，靠 sticky 吸顶
            wrap.dataset.dscMode = 'inside'
            scroller.insertBefore(wrap, section)
          }
        }
        const bar = wrap.querySelector('.dsc-filter-btn')
        if (bar) paintFilterBar(bar)
      }

      ensure()
      const unsubscribe = store.subscribe(() => {
        const wrap = document.getElementById(FILTER_BAR_ID)
        if (!wrap) return
        const bar = wrap.querySelector('.dsc-filter-btn')
        if (bar) paintFilterBar(bar)
      })

      // 侧边栏重渲染可能把插入的节点冲掉。这里不用 MutationObserver 盯整个 document.body
      // （流式输出时 mutation 极密，回调会被叫几百次/秒），改成 500ms 查一次自己还在不在：
      // 一次 getElementById 而已，代价可忽略，最坏晚 0.5s 补回来。
      const timer = setInterval(() => {
        // 筛选中：每次巡检顺手确认观察者还盯着当前容器（React 换 DOM 时会换掉）
        if (allowedIds !== null) {
          try {
            ensureFilterObserver()
          } catch {
            /* 侧边栏正在重建的瞬间拿不到容器，下次再试 */
          }
        }
        if (document.getElementById(FILTER_BAR_ID)) return
        ensure()
      }, 500)

      return () => {
        clearInterval(timer)
        unsubscribe()
        document.getElementById(FILTER_BAR_ID)?.remove()
      }
    }

    /** 分类清单弹层（挂在 overlay，向上弹）。 */
    function SidebarFilterPanel() {
      const state = useStore()
      const t = state.__t
      const data = state.data
      const ref = useRef(null)
      const open = Boolean(state.filterOpen)
      const anchor = state.filterAnchor

      // 清单要显示每个分类的条数、选中后也要靠会话清单算命中集合：
      // 打不开这个弹层时才第一次需要全量状态，之前只拉过 /hints（lite data）。
      useEffect(() => {
        if (!open) return
        if (store.get().data?.sessionsLoaded !== true) refreshState()
      }, [open])

      useLayoutEffect(() => {
        const element = ref.current
        if (!element) return
        element.style.transform = 'none'
        const rect = element.getBoundingClientRect()
        const width = rect.width || 252
        const height = rect.height || 300
        // 往侧边弹：贴在侧栏右缘之外，而不是盖在会话列表上（列表被压住时看不到自己被筛掉了哪些）
        const side = (anchor?.right ?? (anchor?.x ?? 12) + 236) + 12
        const left = Math.max(8, Math.min(side, window.innerWidth - width - 8))
        // 竖直方向跟入口那一行对齐，不再往下压 34px 的按钮高度
        const top = Math.max(8, Math.min((anchor?.y ?? 200) - 6, window.innerHeight - height - 8))
        element.style.transform = `translate(${Math.round(left - rect.left)}px, ${Math.round(top - rect.top)}px)`
      })

      if (!open || !data) return null

      // 会话清单到没到（启动阶段只有 /hints 的 lite data）。
      // 注意：清单只影响**条数**，不再阻塞渲染 —— 分类筛选靠 assignments 就能即时生效，
      // 等 /state 冷扫 2 秒才让清单出现，就是「点一下要等 3 秒」的来源。
      const sessionsReady = data.sessionsLoaded === true

      const counts = new Map()
      // 每个分类里最新一条会话的活动时间：只有「按活跃」排序才用得上
      const lastAt = new Map()
      for (const session of data.sessions ?? []) {
        const id = data.assignments?.[session.id]
        if (!id) continue
        counts.set(id, (counts.get(id) ?? 0) + 1)
        const at = session.updatedAt ?? session.createdAt ?? 0
        if (at > (lastAt.get(id) ?? 0)) lastAt.set(id, at)
      }
      if (!sessionsReady) {
        // 清单没到时用归属表兜底：分类下有几条会话立刻就能显示
        // （差一层「已删除会话」的过滤，清单到了就会被准确值替换）
        for (const assignedId of Object.values(data.assignments ?? {})) {
          counts.set(assignedId, (counts.get(assignedId) ?? 0) + 1)
        }
      }
      const uncategorized = sessionsReady
        ? (data.sessions ?? []).filter((item) => !data.assignments?.[item.id]).length
        : null
      const countText = (value) => (value === null || value === undefined ? '·' : String(value))
      const close = () => store.set({ filterOpen: false })
      const pick = (categoryId) => {
        store.set({ filterCategory: categoryId, filterOpen: false })
      }

      // 顺序可配：默认「按创建」——位置稳定，同一份清单点几次都一样；
      // 「按活跃」跟分类页一致（最新会话倒序、空分类沉底），但每次点开位置会变。
      const filterSort = data.settings?.filterSort === 'activity' ? 'activity' : 'created'
      const listed = (data.categories ?? []).filter((category) => !category.archived)
      const orderedCategories =
        filterSort === 'activity'
          ? [...listed].sort((a, b) => {
              const left = lastAt.get(a.id) ?? 0
              const right = lastAt.get(b.id) ?? 0
              if (left && right) return right - left
              if (left) return -1
              if (right) return 1
              return (b.createdAt ?? 0) - (a.createdAt ?? 0)
            })
          : listed

      const rows = [
        h(
          'button',
          {
            key: '__all',
            className: 'dsc-filter-row',
            'data-on': !state.filterCategory ? 'true' : 'false',
            onClick: () => pick(''),
          },
          h('span', { className: 'dsc-filter-name' }, t('filter.all')),
          h(
            'span',
            { className: 'dsc-filter-count' },
            countText(sessionsReady ? (data.sessions ?? []).length : null),
          ),
        ),
        orderedCategories.map((category) =>
          h(
            'button',
            {
              key: category.id,
              className: 'dsc-filter-row',
              'data-on': state.filterCategory === category.id ? 'true' : 'false',
              onClick: () => pick(category.id),
            },
            h('i', { className: 'dsc-dot', style: { background: category.color, width: 8, height: 8 } }),
            h('span', { className: 'dsc-filter-name' }, category.name),
            h('span', { className: 'dsc-filter-count' }, countText(counts.get(category.id) ?? 0)),
          ),
        ),
        h(
          'button',
          {
            key: '__uncategorized',
            className: 'dsc-filter-row',
            'data-on': state.filterCategory === '__uncategorized' ? 'true' : 'false',
            onClick: () => pick('__uncategorized'),
          },
          h('i', { className: 'dsc-dot', style: { background: 'var(--dsw-alias-border-l2)', width: 8, height: 8 } }),
          h('span', { className: 'dsc-filter-name' }, t('panel.uncategorized')),
          h('span', { className: 'dsc-filter-count' }, countText(uncategorized)),
        ),
      ]

      return h(
        'div',
        { className: 'dsc-filter-layer', onClick: (event) => event.target === event.currentTarget && close() },
        h(
          'div',
          { className: 'dsc-filter-pop', ref, role: 'dialog' },
          h(
            'div',
            { className: 'dsc-filter-head' },
            h('span', null, t('filter.title')),
            state.filterCategory
              ? h('button', { className: 'dsc-filter-clear', onClick: () => pick('') }, t('filter.clear'))
              : null,
          ),
          h('div', { className: 'dsc-filter-list' }, rows),
        ),
      )
    }

    function CategoryIcon({ size = 18, active }) {
      const stroke = 'currentColor'
      return h(
        'svg',
        {
          width: size,
          height: size,
          // 悬停就把会话清单预热起来：从「鼠标移到图标」到「真的点下去」通常有几百毫秒
          onPointerEnter: () => warmSessionList(),
          onFocus: () => warmSessionList(),
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke,
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { opacity: active ? 1 : 0.85, display: 'block' },
        },
        h('rect', { x: 3, y: 4, width: 18, height: 5.5, rx: 2 }),
        h('rect', { x: 3, y: 12, width: 12.5, height: 4, rx: 1.6 }),
        h('rect', { x: 3, y: 18, width: 16, height: 3, rx: 1.4 }),
      )
    }

    function ChevronIcon() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M6 9l6 6 6-6' }),
      )
    }

    function GearIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 12, cy: 12, r: 3.2 }),
        h('path', {
          d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z',
        }),
      )
    }

    function SearchIcon() {
      return h(
        'svg',
        {
          width: 13,
          height: 13,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 11, cy: 11, r: 7 }),
        h('path', { d: 'M20 20l-3.6-3.6' }),
      )
    }

    function MoveIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3 7.5h7l2 2.5h9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z' }),
        h('path', { d: 'M3 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4L10 7' }),
      )
    }

    function svgIcon(size, strokeWidth, children) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        ...children,
      )
    }

    // 归档 = 档案盒 + 收进去的箭头（只画「盒+盖+横线」在小尺寸下像垃圾桶/纸箱）
    function ArchiveIcon({ size = 13 }) {
      return svgIcon(size, 1.8, [
        h('rect', { key: 'lid', x: 3, y: 4, width: 18, height: 4, rx: 1 }),
        h('path', { key: 'body', d: 'M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8' }),
        h('path', { key: 'shaft', d: 'M12 10.8v5' }),
        h('path', { key: 'head', d: 'M9.6 13.4 12 15.8l2.4-2.4' }),
      ])
    }

    // 恢复 = 同一个档案盒，箭头朝上拿出来
    function UnarchiveIcon({ size = 13 }) {
      return svgIcon(size, 1.8, [
        h('rect', { key: 'lid', x: 3, y: 4, width: 18, height: 4, rx: 1 }),
        h('path', { key: 'body', d: 'M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8' }),
        h('path', { key: 'shaft', d: 'M12 15.8v-5' }),
        h('path', { key: 'head', d: 'M9.6 13.2 12 10.8l2.4 2.4' }),
      ])
    }

    function BackIcon({ size = 16 }) {
      return svgIcon(size, 1.9, [h('path', { key: 'arrow', d: 'M19 12H5' }), h('path', { key: 'head', d: 'M11 18l-6-6 6-6' })])
    }

    // ------------------------------------------------------------ 主面板

    function useStore() {
      return useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    function CategoriesPanel({ closePanel }) {
      const state = useStore()
      const t = state.__t
      const data = state.data
      const [creating, setCreating] = useState(false)
      const [draftName, setDraftName] = useState('')
      const [picking, setPicking] = useState(null)
      const [renaming, setRenaming] = useState(null)
      const [settingsOpen, setSettingsOpen] = useState(false)
      // 待处理建议默认收起，右上角按钮展开（不会一直占着顶部空间）
      const [pendingOpen, setPendingOpen] = useState(false)
      const [query, setQuery] = useState('')
      const bodyRef = useRef(null)
      /** 输入法是否正在组合候选词：组合期间的回车/失焦都不当成提交。 */
      const composingRef = useRef(false)
      // 头部按钮要显示条数，必须在使用之前算好
      const pendingCount = pendingSuggestions(state).length

      // 每次打开弹窗检查一次：从没拉过、或缓存超过 10 秒就重新拉。
      // 只依赖挂载时机，避免分类数据一变化就触发全量刷新。
      useEffect(() => {
        const age = Date.now() - (store.get().dataAt || 0)
        const current = store.get().data
        // sessionsLoaded 为假 = 现在这份是 /hints 的 lite data，必须补全量（否则列表是空的）
        if (!current || !current.sessionsLoaded || age > 10000) refreshState()
      }, [])

      const close = useCallback(() => {
        if (typeof closePanel === 'function') closePanel()
      }, [closePanel])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [close])

      /** 弹窗外框：遮罩点击关闭，内部点击不冒泡。 */
      const frame = (body) =>
        h(
          'div',
          {
            className: 'dsc-backdrop',
            onClick: (event) => {
              if (event.target === event.currentTarget) close()
            },
          },
          h(
            'div',
            {
              className: 'dsc-dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'data-busy': state.busy ? 'true' : 'false',
              'aria-busy': state.busy ? 'true' : 'false',
              onClick: (event) => event.stopPropagation(),
            },
            state.busy ? h('div', { className: 'dsc-progress' }) : null,
            body,
          ),
        )

      const actions = useMemo(
        () => ({
          assign: (sessionId, categoryId) => assign(sessionId, categoryId),
        }),
        [],
      )

      // 会话清单没到（启动阶段只有 /hints 的 lite data）时显示加载态：
      // 否则会先闪一个「一个分类都没有」的空列表
      if (!data || data.sessionsLoaded === false) {
        if (state.phase === 'error') {
          return frame(
            h(
              'div',
              { className: 'dsc-dialog-body' },
              h('div', { className: 'dsc-empty' }, state.error),
              h(
                'div',
                { className: 'dsc-empty' },
                h('button', { className: 'dsc-btn', onClick: () => refreshState() }, t('panel.reload')),
              ),
            ),
          )
        }
        // 骨架屏：分类结构 /hints 里已经有了，先按「分类标题 + 几行会话」占住位置，
        // 会话清单（含标题）到了再整体替换，视觉上不会是一块空白。
        return frame(
          h(
            'div',
            { className: 'dsc-dialog-body' },
            h(
              'div',
              { className: 'dsc-skel' },
              h('div', { className: 'dsc-skel-note' }, t('panel.loading')),
              [0, 1, 2].map((index) =>
                h(
                  'div',
                  { className: 'dsc-skel-cat', key: index },
                  h('div', { className: 'dsc-skel-line w40' }),
                  h('div', { className: 'dsc-skel-line' }),
                  h('div', { className: 'dsc-skel-line w80' }),
                  h('div', { className: 'dsc-skel-line w60' }),
                ),
              ),
            ),
          ),
        )
      }

      const { categories, sessions, assignments, settings } = data
      const activeCategories = categories.filter((category) => !category.archived)
      const archivedCategories = categories.filter((category) => category.archived)
      // 归档分类是独立视图，主列表里不混入
      const archivedView = Boolean(state.archivedView)

      // 搜索：标题 / 会话 id / 工作区 / 所属分类名，任一命中即可。
      // 搜分类名时保留该分类下的全部会话，方便「找某类里的东西」。
      const needle = query.trim().toLowerCase()
      const categoryNameOf = new Map(categories.map((c) => [c.id, c.name]))
      const matchesQuery = (session) => {
        if (!needle) return true
        const categoryName = categoryNameOf.get(assignments[session.id]) ?? ''
        return (
          (session.title ?? '').toLowerCase().includes(needle) ||
          session.id.toLowerCase().includes(needle) ||
          (session.workspace?.title ?? '').toLowerCase().includes(needle) ||
          categoryName.toLowerCase().includes(needle) ||
          // 未分类的会话也认「未分类」这个词
          (!assignments[session.id] && t('panel.uncategorized').toLowerCase().includes(needle))
        )
      }

      const byCategory = new Map(categories.map((c) => [c.id, []]))
      const unassigned = []
      let matched = 0
      for (const session of sessions) {
        if (!matchesQuery(session)) continue
        matched += 1
        const categoryId = assignments[session.id]
        if (categoryId && byCategory.has(categoryId)) byCategory.get(categoryId).push(session)
        else unassigned.push(session)
      }

      // 分类排序：按分类里最近一条会话的活动时间倒序；空分类排后面（新建的在前）。
      const lastActivityOf = (categoryId) => {
        const list = byCategory.get(categoryId) ?? []
        return list.length > 0 ? (list[0].updatedAt ?? list[0].createdAt ?? 0) : 0
      }
      const sortByActivity = (list) =>
        [...list].sort((a, b) => {
          const left = lastActivityOf(a.id)
          const right = lastActivityOf(b.id)
          if (left && right) return right - left
          if (left) return -1
          if (right) return 1
          return (b.createdAt ?? 0) - (a.createdAt ?? 0)
        })
      const sortedCategories = sortByActivity(activeCategories)
      const sortedArchived = sortByActivity(archivedCategories)

      const workspaces = []
      const seenWorkspace = new Set()
      for (const session of sessions) {
        if (!session.workspace || seenWorkspace.has(session.workspace.id)) continue
        seenWorkspace.add(session.workspace.id)
        workspaces.push(session.workspace)
      }

      const createCategory = async () => {
        const name = draftName.trim()
        if (!name) {
          setCreating(false)
          return
        }
        setDraftName('')
        setCreating(false)
        await withBusy('category', async () => {
          applyState(await mutate('/category', { action: 'create', name }))
        })
      }

      const newSession = async (categoryId) => {
        await withBusy(`new:${categoryId}`, async () => {
          const workspaceId = store.get().data?.settings?.newSessionWorkspaceId || ''
          const result = await mutate('/new-session', {
            categoryId,
            workspaceId: workspaceId || undefined,
          })
          if (result?.sessionId) {
            if (store.get().__openSession) store.get().__openSession(result.sessionId)
            // 新建会话会改变会话清单，这里必须整份刷新
            refreshState()
          }
        })
      }

      const head = h(
        'div',
        { className: 'dsc-head' },
        h(
          'div',
          null,
          h('h1', null, settingsOpen ? t('settings.title') : state.callsOpen ? t('calls.title') : t('panel.title')),
          h('p', null, settingsOpen ? t('settings.subtitle') : state.callsOpen ? t('calls.subtitle') : t('panel.subtitle')),
        ),
        h(
          'div',
          { className: 'dsc-head-actions' },
          settingsOpen
            ? h(
                'button',
                { className: 'dsc-btn', onClick: () => setSettingsOpen(false) },
                t('panel.back'),
              )
            : null,
          // 待处理建议：默认收起，按钮上带条数
          settingsOpen || state.callsOpen || archivedView || pendingCount === 0
            ? null
            : h(
                'button',
                {
                  className: 'dsc-btn dsc-pending-toggle',
                  'data-on': pendingOpen ? 'true' : 'false',
                  title: t('pending.title'),
                  onClick: () => setPendingOpen((open) => !open),
                },
                t('pending.title'),
                h('b', null, String(pendingCount)),
              ),
          settingsOpen || state.callsOpen || archivedView
            ? null
            : workspaces.length > 0
            ? h(
                'select',
                {
                  className: 'dsc-select',
                  // 选择结果落到 Host 的 settings，重开面板 / 重启都保留
                  value: settings.newSessionWorkspaceId ?? '',
                  title: t('panel.workspace'),
                  onChange: async (event) => {
                    const next = event.target.value
                    store.set({ data: { ...store.get().data, settings: { ...settings, newSessionWorkspaceId: next } } })
                    const result = await mutate('/settings', { newSessionWorkspaceId: next })
                    if (result) {
                      store.set({ data: { ...store.get().data, settings: result.settings } })
                    }
                  },
                },
                h('option', { value: '' }, t('panel.workspaceDefault')),
                workspaces.map((workspace) =>
                  h('option', { key: workspace.id, value: workspace.id }, workspace.title || workspace.id),
                ),
              )
            : null,
          settingsOpen || state.callsOpen
            ? null
            : creating
            ? h('input', {
                className: 'dsc-input',
                autoFocus: true,
                placeholder: t('panel.categoryNamePlaceholder'),
                value: draftName,
                onChange: (event) => setDraftName(event.target.value),
                // 输入法组合期间的回车是「上屏候选词」，不能当成提交
                onCompositionStart: () => {
                  composingRef.current = true
                },
                onCompositionEnd: () => {
                  composingRef.current = false
                },
                onKeyDown: (event) => {
                  if (event.nativeEvent?.isComposing || composingRef.current) return
                  if (event.key === 'Enter') createCategory()
                  if (event.key === 'Escape') {
                    setCreating(false)
                    setDraftName('')
                  }
                },
                onBlur: () => {
                  if (composingRef.current) return
                  createCategory()
                },
              })
            : h(
                'button',
                { className: 'dsc-btn', onClick: () => setCreating(true) },
                t('panel.newCategory'),
              ),
          settingsOpen || state.callsOpen
            ? null
            : h(
                'button',
                {
                  className: 'dsc-icon-btn',
                  'data-on': archivedView && archivedCategories.length > 0 ? 'true' : 'false',
                  title: archivedView
                    ? t('archived.backToList')
                    : t('panel.archivedEntry', { n: archivedCategories.length }),
                  'aria-label': archivedView
                    ? t('archived.backToList')
                    : t('panel.archivedEntry', { n: archivedCategories.length }),
                  onClick: () => {
                    if (!archivedView && archivedCategories.length === 0) {
                      toast(t('panel.archivedEmpty'))
                      return
                    }
                    const next = !archivedView
                    store.set({ archivedView: next })
                    bodyRef.current?.scrollTo({ top: 0 })
                  },
                },
                archivedView ? h(BackIcon, { size: 16 }) : h(ArchiveIcon, { size: 16 }),
              ),
          state.callsOpen
            ? null
            : h(
                'button',
                {
                  className: 'dsc-icon-btn',
                  title: t('settings.title'),
                  'aria-label': t('settings.title'),
                  'data-on': settingsOpen ? 'true' : 'false',
              onClick: () => setSettingsOpen((open) => !open),
            },
            h(GearIcon),
          ),
          h('button', { className: 'dsc-btn ghost', title: t('panel.close'), onClick: close }, '✕'),
        ),
      )

      // 设置页复用同一个弹窗外框：顶部标题换成设置、正文换成表单
      if (settingsOpen) {
        return frame(
          h(
            React.Fragment,
            null,
            head,
            h('div', { className: 'dsc-dialog-body' }, h(SettingsView, { onClose: () => setSettingsOpen(false) })),
            state.toast ? h('div', { className: 'dsc-toast' }, state.toast) : null,
          ),
        )
      }

      if (state.callsOpen) {
        return frame(
          h(
            React.Fragment,
            null,
            head,
            h(
              'div',
              { className: 'dsc-dialog-body' },
              h(CallsView, { onClose: () => store.set({ callsOpen: false }) }),
            ),
            state.toast ? h('div', { className: 'dsc-toast' }, state.toast) : null,
          ),
        )
      }

      /** 命中片段高亮；没有搜索词就原样返回。 */
      const highlightHit = (text, word) => {
        if (!word) return text
        const index = String(text).toLowerCase().indexOf(word)
        if (index < 0) return text
        return [
          text.slice(0, index),
          h('mark', { key: 'hit' }, text.slice(index, index + word.length)),
          text.slice(index + word.length),
        ]
      }

      const renderSession = (session, inCategoryId) => {
        const category = categoryOf(data, null, session.id)
        return h(
          'div',
          { key: session.id, className: 'dsc-row-wrap' },
          h(
            'div',
            {
              className: 'dsc-row',
              // 整行可点：鼠标落在行内任何地方都能打开会话（空白的右侧也行）
              onClick: () => {
                const open = store.get().__openSession
                if (open) open(session.id)
              },
            },
            h(
              'span',
              {
                className: 'dsc-row-title',
                // 只有可能被省略号截断的长标题才挂原生提示，短的没必要弹灰气泡
                title: (session.title || '').length > 30 ? session.title : undefined,
              },
              highlightHit(session.title || t('panel.untitled'), needle),
            ),
            session.workspace
              ? h('span', { className: 'dsc-row-ws', title: session.workspace.title || '' }, session.workspace.title || '')
              : null,
            h('span', { className: 'dsc-row-meta' }, timeAgo(t, session.updatedAt ?? session.createdAt)),
            h(
              'button',
              {
                className: 'dsc-action',
                title: t('panel.moveTo'),
                onClick: (event) => {
                  // 整行可点之后，按钮的点击不能再冒泡成「打开会话」
                  event.stopPropagation()
                  setPicking(picking === session.id ? null : session.id)
                },
              },
              h(MoveIcon),
            ),
          ),
          picking === session.id
            ? h(
                'div',
                { className: 'dsc-chips' },
                h(
                  'button',
                  {
                    className: 'dsc-chip',
                    'data-active': category ? 'false' : 'true',
                    onClick: () => {
                      actions.assign(session.id, '')
                      setPicking(null)
                    },
                  },
                  t('panel.uncategorized'),
                ),
                categories.map((item) =>
                  h(
                    'button',
                    {
                      key: item.id,
                      className: 'dsc-chip',
                      'data-active': category?.id === item.id ? 'true' : 'false',
                      onClick: () => {
                        actions.assign(session.id, item.id)
                        setPicking(null)
                      },
                    },
                    h('i', { className: 'dsc-dot', style: { background: item.color, width: 6, height: 6 } }),
                    item.name,
                  ),
                ),
              )
            : null,
        )
      }

      /** 一个分类块。主列表和「已归档」区共用，归档时多一个标记与「恢复」入口。 */
      const renderCategory = (category, isArchived = false) => {
        const list = byCategory.get(category.id) ?? []
        const collapsed = Boolean(state.collapsed[category.id])
        const open = !collapsed
        const expanded = Boolean(state.expanded?.[category.id])
        // 搜索时不再分页：结果本来就少，还要翻页反而碍事
        const shown = expanded || needle ? list : list.slice(0, PAGE_SIZE)
        const hidden = list.length - shown.length
        return h(
          'div',
          {
            className: 'dsc-cat',
            key: category.id,
            id: `dsc-cat-${category.id}`,
            style: { '--dsc-cat-color': category.color },
            'data-archived': isArchived ? 'true' : 'false',
            'data-open': open ? 'true' : 'false',
            'data-empty': list.length === 0 ? 'true' : 'false',
          },
          h(
            'div',
            { className: 'dsc-cat-head' },
            h(
              'button',
              {
                className: 'dsc-cat-toggle',
                'data-collapsed': collapsed ? 'true' : 'false',
                onClick: () =>
                  store.set({
                    collapsed: { ...store.get().collapsed, [category.id]: !collapsed },
                  }),
                title: collapsed ? t('panel.expand') : t('panel.collapse'),
              },
              h(ChevronIcon),
            ),
            h(
              'div',
              { className: 'dsc-cat-title' },
              h('i', { className: 'dsc-dot', style: { background: category.color } }),
              renaming === category.id
              ? h('input', {
                  className: 'dsc-input',
                  autoFocus: true,
                  defaultValue: category.name,
                  onCompositionStart: () => {
                    composingRef.current = true
                  },
                  onCompositionEnd: () => {
                    composingRef.current = false
                  },
                  onKeyDown: async (event) => {
                    if (event.nativeEvent?.isComposing || composingRef.current) return
                    if (event.key === 'Escape') setRenaming(null)
                    if (event.key === 'Enter') {
                      const value = event.target.value.trim()
                      setRenaming(null)
                      if (value && value !== category.name) {
                        await withBusy('category', async () => {
                          applyState(await mutate('/category', { action: 'rename', id: category.id, name: value }))
                        })
                      }
                    }
                  },
                  onBlur: () => setRenaming(null),
                })
              : h('span', { className: 'dsc-cat-name' }, category.name),
              h('span', { className: 'dsc-cat-count' }, String(list.length)),
            ),
            h(
              'div',
              { className: 'dsc-cat-actions' },
              h(
                'button',
                {
                  className: 'dsc-btn ghost',
                  title: t('panel.rename'),
                  onClick: () => setRenaming(category.id),
                },
                '✎',
              ),
              h(
                'button',
                {
                  className: 'dsc-btn ghost',
                  title: isArchived ? t('panel.unarchive') : t('panel.archive'),
                  onClick: async () => {
                    await withBusy('category', async () => {
                      const result = await mutate('/category', {
                        action: isArchived ? 'unarchive' : 'archive',
                        id: category.id,
                      })
                      if (!result) return
                      applyState(result)
                      toast(
                        isArchived
                          ? t('panel.unarchivedToast', { name: category.name })
                          : t('panel.archivedToast', { name: category.name }),
                      )
                    })
                  },
                },
                isArchived ? h(UnarchiveIcon) : h(ArchiveIcon),
              ),
              h(
                'button',
                {
                  className: 'dsc-btn ghost',
                  title: t('panel.delete'),
                  onClick: async () => {
                    if (!window.confirm(t('panel.deleteConfirm', { name: category.name }))) return
                    await withBusy('category', async () => {
                      applyState(await mutate('/category', { action: 'delete', id: category.id }))
                    })
                  },
                },
                '🗑',
              ),
              h(
                'button',
                {
                  className: 'dsc-btn ghost',
                  title: t('panel.newSession'),
                  disabled: state.busy === `new:${category.id}`,
                  onClick: () => newSession(category.id),
                },
                '+',
              ),
            ),
          ),
          collapsed
            ? null
            : h(
                'div',
                { className: 'dsc-rows' },
                shown.map((session) => renderSession(session, category.id)),
                // 展开后 hidden 就是 0 了，但仍要留一个「收起」按钮，否则点开就回不去
                hidden > 0 || expanded
                  ? h(
                      'button',
                      {
                        className: 'dsc-more',
                        onClick: () =>
                          store.set({
                            expanded: { ...store.get().expanded, [category.id]: !expanded },
                          }),
                      },
                      expanded
                        ? t('panel.collapseList')
                        : t('panel.showAll', { n: list.length }),
                    )
                  : null,
              ),
        )
      }

      // 归档是独立视图：主列表里完全不出现归档分类，点顶部归档按钮才切过来
      const listedCategories = archivedView ? sortedArchived : sortedCategories
      // 搜索结果数按当前视图算：归档视图里不该把主列表的命中也算进去
      const viewMatched = archivedView
        ? listedCategories.reduce((sum, category) => sum + (byCategory.get(category.id) ?? []).length, 0)
        : matched
      const visibleCategories = listedCategories.filter(
        (category) => !needle || (byCategory.get(category.id) ?? []).length > 0,
      )
      const categoryBlocks = visibleCategories.map((category) => renderCategory(category, archivedView))
      const archivedEmpty =
        archivedView && visibleCategories.length === 0 && !needle
          ? h('div', { className: 'dsc-empty' }, t('archived.empty'))
          : null
      const archivedBanner = archivedView
        ? h(
            'div',
            { className: 'dsc-archived-banner' },
            h('span', null, t('archived.banner', { n: archivedCategories.length })),
            h(
              'button',
              { className: 'dsc-btn', onClick: () => store.set({ archivedView: false }) },
              t('archived.backToList'),
            ),
          )
        : null

      const uncategorizedOpen = !state.collapsed.__uncategorized
      const uncategorizedExpanded = Boolean(state.expanded?.__uncategorized)
      const uncategorizedShown = uncategorizedExpanded || needle ? unassigned : unassigned.slice(0, PAGE_SIZE)
      const uncategorizedHidden = unassigned.length - uncategorizedShown.length
      const uncategorizedBlock =
        needle && unassigned.length === 0
          ? null
          : h(
        'div',
        {
          className: 'dsc-cat',
          key: '__uncategorized',
          id: 'dsc-cat-__uncategorized',
          style: { '--dsc-cat-color': 'var(--dsw-alias-border-l2)' },
          'data-open': uncategorizedOpen ? 'true' : 'false',
          'data-empty': unassigned.length === 0 ? 'true' : 'false',
        },
        h(
          'div',
          { className: 'dsc-cat-head' },
          h(
            'button',
            {
              className: 'dsc-cat-toggle',
              'data-collapsed': uncategorizedOpen ? 'false' : 'true',
              title: uncategorizedOpen ? t('panel.collapse') : t('panel.expand'),
              onClick: () =>
                store.set({
                  collapsed: { ...store.get().collapsed, __uncategorized: uncategorizedOpen },
                }),
            },
            h(ChevronIcon),
          ),
          h(
            'div',
            { className: 'dsc-cat-title' },
            h('i', { className: 'dsc-dot', style: { background: 'var(--dsw-alias-border-l2)' } }),
            h('span', { className: 'dsc-cat-name' }, t('panel.uncategorized')),
            h('span', { className: 'dsc-cat-count' }, String(unassigned.length)),
          ),
        ),
        uncategorizedOpen
          ? h(
              'div',
              { className: 'dsc-rows' },
              uncategorizedShown.map((session) => renderSession(session, null)),
              uncategorizedHidden > 0 || uncategorizedExpanded
                ? h(
                    'button',
                    {
                      className: 'dsc-more',
                      onClick: () =>
                        store.set({
                          expanded: { ...store.get().expanded, __uncategorized: !uncategorizedExpanded },
                        }),
                    },
                    uncategorizedExpanded
                      ? t('panel.collapseList')
                      : t('panel.showAll', { n: unassigned.length }),
                  )
                : null,
            )
          : null,
      )

      // 顶部横向导航：分类多了不用一路滚，点一下跳到对应分类
      const jumpTargets = [
        ...visibleCategories.map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          count: (byCategory.get(category.id) ?? []).length,
        })),
        archivedView
          ? null
          : { id: '__uncategorized', name: t('panel.uncategorized'), color: '', count: unassigned.length },
      ]
        .filter(Boolean)
        .filter((item) => !needle || item.count > 0)
      const jumpTo = (id) => {
        const body = bodyRef.current
        const element = document.getElementById(`dsc-cat-${id}`)
        if (!body || !element) return
        // 不用 scrollIntoView：它会把块顶对齐到滚动口顶端，吸顶标题刚好盖住第一行。
        // 这里留 10px 余量，让分类标题和第一条会话都完整露出来。
        const delta = element.getBoundingClientRect().top - body.getBoundingClientRect().top - 10
        body.scrollBy({ top: delta, behavior: 'smooth' })
      }
      const jumpBar = h(
        'div',
        { className: 'dsc-jump' },
        jumpTargets.map((item) =>
          h(
            'button',
            {
              key: item.id,
              style: { '--dsc-cat-color': item.color || 'var(--dsw-alias-border-l2)' },
              onClick: () => jumpTo(item.id),
            },
            h('i', {
              className: 'dsc-dot',
              style: {
                background: item.color || 'var(--dsw-alias-border-l2)',
                width: 7,
                height: 7,
              },
            }),
            h('span', null, item.name),
            h('b', null, String(item.count)),
          ),
        ),
      )

      const searchRow = h(
        'div',
        { className: 'dsc-search' },
        h(
          'div',
          { className: 'dsc-search-box' },
          h(SearchIcon),
          h('input', {
            type: 'text',
            value: query,
            placeholder: t('search.placeholder'),
            'aria-label': t('search.placeholder'),
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              // 有搜索词时 Esc 只清输入，不关弹窗
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            },
          }),
          query
            ? h(
                'button',
                {
                  className: 'dsc-search-clear',
                  title: t('search.clear'),
                  onClick: () => setQuery(''),
                },
                '✕',
              )
            : null,
        ),
        needle ? h('span', { className: 'dsc-search-count' }, t('search.results', { n: viewMatched })) : null,
      )

      const searchEmpty =
        needle && viewMatched === 0
          ? h('div', { className: 'dsc-empty' }, t('search.empty', { q: query.trim() }))
          : null

      // 底部统计：自动分类调用了多少次、花了多少 token / 多少钱。
      // 档位（当日 / 本周 / 本月）存在 settings 里，页脚也能直接切。
      const range = ['day', 'week', 'month'].includes(settings.costRange) ? settings.costRange : 'day'
      const autoUsage = data.usage?.periods?.[range]?.auto ?? data.usage?.auto
      const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0))
      const fmtCost = (value) => {
        const amount = Number(value)
        if (!Number.isFinite(amount) || amount <= 0) return ''
        if (amount >= 1) return `¥${amount.toFixed(2)}`
        if (amount >= 0.01) return `¥${amount.toFixed(3)}`
        return `¥${amount.toFixed(4)}`
      }
      const costText = fmtCost(autoUsage?.costCny)
      const changeRange = async (next) => {
        store.set({ data: { ...store.get().data, settings: { ...settings, costRange: next } } })
        const result = await mutate('/settings', { costRange: next })
        if (result) store.set({ data: { ...store.get().data, settings: result.settings } })
      }
      const rangeControl = h(
        'div',
        { className: 'dsc-seg' },
        ['day', 'week', 'month'].map((item) =>
          h(
            'button',
            {
              key: item,
              'data-on': range === item ? 'true' : 'false',
              title: t(`range.${item}`),
              onClick: () => changeRange(item),
            },
            t(`range.${item}`),
          ),
        ),
      )
      const usageFoot = h(
        'div',
        { className: 'dsc-foot' },
        autoUsage && autoUsage.calls > 0
          ? h(
              React.Fragment,
              null,
              h('i', {
                className: 'dsc-dot',
                style: { background: 'var(--dsw-alias-brand-primary)', width: 5, height: 5 },
              }),
              h(
                'span',
                null,
                t('panel.usage', {
                  calls: autoUsage.calls,
                  input: fmtTokens(autoUsage.inputTokens),
                  output: fmtTokens(autoUsage.outputTokens),
                }),
              ),
              h(
                'button',
                {
                  className: 'dsc-foot-cost dsc-foot-link',
                  title: t('calls.open'),
                  onClick: () => store.set({ callsOpen: true }),
                },
                costText ? t('panel.cost', { cost: costText }) : t('calls.open'),
              ),
            )
          : h('span', null, t('panel.usageEmpty')),
        rangeControl,
      )

      // 已经有建议挂着的会话在这里列出来：卡片在输入框边上，不在面板里不容易发现
      const pendingStrip =
        pendingOpen && pendingCount > 0 && !archivedView && !settingsOpen && !state.callsOpen
          ? h(PendingStrip)
          : null

      return frame(
        h(
          React.Fragment,
          null,
          head,
          searchRow,
          pendingStrip,
          jumpBar,
          h(
            'div',
            { className: 'dsc-dialog-body dsc-dialog-body-flush', ref: bodyRef },
            // 内边距放在内层：外层不留 padding，吸顶标题才能真正贴住滚动口顶端，
            // 否则标题会停在 padding 下面，上面留一条 14px 的缝，下面的会话从缝里穿过去
            h(
              'div',
              { className: 'dsc-body-pad' },
              archivedBanner,
              searchEmpty,
              archivedEmpty,
              searchEmpty ? null : categoryBlocks,
              searchEmpty || archivedView ? null : uncategorizedBlock,
            ),
          ),
          usageFoot,
          state.toast ? h('div', { className: 'dsc-toast' }, state.toast) : null,
        ),
      )
    }

    // ------------------------------------------------------------ 会话行：分类标记

    function SessionCategoryMark({ sessionId }) {
      const state = useStore()
      const data = state.data
      if (!data) return null
      // 关掉标记后不渲染：分类信息还在悬停卡片里
      if (data.settings?.showRowMark === false) return null
      const category = categoryOf(data, null, sessionId)
      if (!category) return null
      return h(
        'span',
        { className: 'dsc-mark', title: category.name },
        h('i', { style: { background: category.color } }),
      )
    }

    /** 悬停卡片里的一行：会话行不显示标记时，这里是唯一能看出分类的地方。 */
    function SessionCategoryHover({ sessionId }) {
      const state = useStore()
      const data = state.data
      if (!data) return null
      const category = categoryOf(data, null, sessionId)
      if (!category) return null
      return h(
        'div',
        { className: 'dsc-hover-cat' },
        h('i', { className: 'dsc-dot', style: { background: category.color, width: 7, height: 7 } }),
        h('span', null, category.name),
      )
    }

    // ------------------------------------------------------------ 设置面板

    /** 数字项在表单里保持字符串，保存时才转成数字，避免输入过程被打断。 */
    function numberDraft(value, fallback) {
      return Number.isFinite(Number(value)) ? String(value) : String(fallback)
    }

    // ------------------------------------------------------------ 待处理建议 & 调用记录

    /** 把 category hints 和 title hints 摊平成一张待处理清单，按时间倒序。 */
    function pendingSuggestions(state) {
      const data = state.data
      if (!data) return []
      const sessions = new Map((data.sessions ?? []).map((item) => [item.id, item]))
      const categories = new Map((data.categories ?? []).map((item) => [item.id, item]))
      const items = []
      for (const [sessionId, hint] of Object.entries(state.hints ?? {})) {
        for (const candidate of hint.candidates ?? []) {
          const category = categories.get(candidate.categoryId)
          if (!category) continue
          items.push({
            key: `${sessionId}:category:${category.id}`,
            sessionId,
            kind: 'category',
            categoryId: category.id,
            category,
            title: sessions.get(sessionId)?.title ?? '',
            at: candidate.at ?? 0,
          })
        }
      }
      for (const [sessionId, hint] of Object.entries(state.titleHints ?? {})) {
        if (!hint?.title) continue
        items.push({
          key: `${sessionId}:title`,
          sessionId,
          kind: 'title',
          next: hint.title,
          title: sessions.get(sessionId)?.title ?? '',
          at: hint.at ?? 0,
        })
      }
      return items.sort((a, b) => b.at - a.at)
    }

    /**
     * 同一条会话的建议合并成一行：分类建议和标题建议各是一块可点的 chip。
     * 点哪块就采纳哪块 —— 两条建议互不影响，不需要为「分开采纳」再拆成两行。
     */
    function pendingGroups(state) {
      const groups = new Map()
      for (const item of pendingSuggestions(state)) {
        const group = groups.get(item.sessionId) ?? {
          sessionId: item.sessionId,
          title: item.title,
          at: item.at,
          category: null,
          titleNext: '',
        }
        if (item.kind === 'category' && !group.category) group.category = item
        if (item.kind === 'title') {
          group.titleNext = item.next
          group.titleAt = item.at
        }
        group.at = Math.max(group.at, item.at)
        groups.set(item.sessionId, group)
      }
      return [...groups.values()].sort((a, b) => b.at - a.at)
    }

    /**
     * 面板顶部的「待处理建议」条：一条会话一行。
     *
     * 一条会话可能同时有分类建议和标题建议，合并成一行，但两块建议各自独立：
     * 点分类 chip = 采纳这条分类；点标题 chip = 采纳这个标题；点 ▾ 换分类；
     * 行尾的「忽略」只作用于整条会话（两条建议一起丢掉）。
     */
    function PendingStrip({ limit = 4 }) {
      const state = useStore()
      const t = state.__t
      const [busy, setBusy] = useState('')
      const [expanded, setExpanded] = useState(false)
      const groups = pendingGroups(state)
      if (groups.length === 0) return null
      const shown = expanded ? groups : groups.slice(0, limit)

      const acceptCategory = async (group, categoryId) => {
        setBusy(`${group.sessionId}:cat`)
        const result = await mutate('/hint', { action: 'accept', sessionId: group.sessionId, categoryId })
        setBusy('')
        if (!result) return
        await refreshState()
        refreshHints()
      }

      const acceptTitle = async (group) => {
        setBusy(`${group.sessionId}:title`)
        const result = await mutate('/title', {
          action: 'accept',
          sessionId: group.sessionId,
          title: group.titleNext,
        })
        setBusy('')
        if (!result) return
        await refreshState()
        refreshHints()
      }

      /** 忽略整条会话的建议：分类提示丢掉、标题建议也一起丢掉（并永久不再提示标题）。 */
      const ignoreAll = async (group) => {
        setBusy(`${group.sessionId}:all`)
        if (group.category) await mutate('/hint', { action: 'dismiss', sessionId: group.sessionId })
        if (group.titleNext) await mutate('/title', { action: 'dismiss', sessionId: group.sessionId })
        setBusy('')
        await refreshState()
        refreshHints()
      }

      return h(
        'div',
        { className: 'dsc-pending' },
        h(
          'div',
          { className: 'dsc-pending-head' },
          h('span', null, t('pending.title')),
          h('b', null, String(groups.length)),
        ),
        h(
          'div',
          { className: 'dsc-pending-cols' },
          h('span', null, t('pending.colSession')),
          h('span', null, t('pending.colSuggestion')),
          h('span', null, ''),
        ),
        shown.map((group) =>
          h(
            'div',
            { className: 'dsc-pending-row', key: group.sessionId },
            // 不再挂原生 title：行里已经写着同样的标题，悬停再弹一遍是重复信息
            h('span', { className: 'dsc-pending-name' }, group.title || group.sessionId),
            h(
              'span',
              { className: 'dsc-pending-sug' },
              group.category
                ? h(
                    'span',
                    { className: 'dsc-pending-slot' },
                    h(
                      'button',
                      {
                        className: 'dsc-sug-accept',
                        disabled: busy.startsWith(group.sessionId),
                        title: t('pending.acceptCategory'),
                        onClick: () => acceptCategory(group, group.category.categoryId),
                      },
                      t('pending.category'),
                      h('i', {
                        className: 'dsc-dot',
                        style: { background: group.category.category.color, width: 7, height: 7 },
                      }),
                      h('span', { className: 'dsc-pending-value' }, group.category.category.name),
                    ),
                    h(
                      'button',
                      {
                        className: 'dsc-sug-caret',
                        disabled: busy.startsWith(group.sessionId),
                        title: t('pending.pick'),
                        onClick: (event) => {
                          event.stopPropagation()
                          store.set({
                            moveTarget: {
                              sessionId: group.sessionId,
                              displayTitle: group.title,
                              x: event.clientX,
                              y: event.clientY,
                            },
                          })
                        },
                      },
                      '▾',
                    ),
                  )
                : null,
              group.titleNext
                ? h(
                    'button',
                    {
                      className: 'dsc-sug-accept',
                      disabled: busy.startsWith(group.sessionId),
                      title: t('pending.acceptTitle'),
                      onClick: () => acceptTitle(group),
                    },
                    t('pending.rename'),
                    h('span', { className: 'dsc-pending-value' }, group.titleNext),
                  )
                : null,
            ),
            h(
              'span',
              { className: 'dsc-pending-actions' },
              h(
                'button',
                {
                  className: 'dsc-mini-btn',
                  disabled: busy.startsWith(group.sessionId),
                  onClick: () => ignoreAll(group),
                },
                t('pending.ignore'),
              ),
            ),
          ),
        ),
        groups.length > limit
          ? h(
              'button',
              {
                className: 'dsc-pending-more',
                onClick: () => setExpanded((value) => !value),
              },
              expanded ? t('pending.collapse') : t('pending.expand', { n: groups.length - limit }),
            )
          : null,
      )
    }

    /** 调用记录：每次模型调用花了多少、判断什么、有没有结果。 */
    function CallsView({ onClose }) {
      const state = useStore()
      const t = state.__t
      const [rows, setRows] = useState([])
      const [busy, setBusy] = useState(false)
      const [loaded, setLoaded] = useState(false)
      // 明细上限由 Host 给：到了上限，差额就不能再解释成「更新前的老调用」
      const [cap, setCap] = useState(0)

      useEffect(() => {
        let alive = true
        request('/calls')
          .then((data) => {
            if (!alive) return
            setRows(Array.isArray(data?.calls) ? data.calls : [])
            setCap(Number(data?.limit) || 0)
            setLoaded(true)
          })
          .catch(() => alive && setLoaded(true))
        return () => {
          alive = false
        }
      }, [])

      const usage = state.data?.usage ?? {}
      const range = state.data?.settings?.costRange ?? 'day'
      const period = usage.periods?.[range] ?? usage
      const autoCalls = Number(period?.auto?.calls ?? 0)
      const manualCalls = Number(period?.manual?.calls ?? 0)
      const autoCost = Number(period?.auto?.costCny ?? 0)
      const manualCost = Number(period?.manual?.costCny ?? 0)
      const calls = autoCalls + manualCalls
      const rangeLabel = t(`range.${['day', 'week', 'month'].includes(range) ? range : 'day'}`)

      // 明细是后加的，之前的调用只进了总数。这里把差额说清楚，免得「133 次却只有一行」看起来像坏了。
      const periodStart = (() => {
        const now = new Date()
        if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
        if (range === 'week') {
          const day = (now.getDay() + 6) % 7
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          return start.getTime() - day * 86400000
        }
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      })()
      const loggedInPeriod = rows.filter((row) => Number(row.at) >= periodStart).length
      const backlog = Math.max(0, calls - loggedInPeriod)

      // 今天的只给时分，往前几天补上日期，否则堆在一起分不清是哪天的账
      const callTime = (at) => {
        const date = new Date(at)
        const clock = date.toLocaleTimeString(state.__locale === 'en' ? 'en-US' : 'zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
        const sameDay = date.toDateString() === new Date().toDateString()
        return sameDay ? clock : `${date.getMonth() + 1}/${date.getDate()} ${clock}`
      }

      const clear = async () => {
        if (!window.confirm(t('calls.clearConfirm'))) return
        setBusy(true)
        try {
          await request('/calls', { method: 'POST', body: JSON.stringify({ action: 'clear' }) })
          setRows([])
        } catch {
          /* 清不掉就保持原样，用户还能再点一次 */
        }
        setBusy(false)
      }

      return h(
        'div',
        { className: 'dsc-calls-view' },
        h(
          'div',
          { className: 'dsc-calls-foot' },
          h(
            'span',
            null,
            t('calls.split', {
              range: rangeLabel,
              autoCalls,
              autoCost: `¥${autoCost.toFixed(4)}`,
              manualCalls,
              manualCost: `¥${manualCost.toFixed(4)}`,
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px' } },
            h('button', { className: 'dsc-btn ghost', disabled: busy || rows.length === 0, onClick: clear }, t('calls.clear')),
            h('button', { className: 'dsc-btn', onClick: onClose }, t('calls.close')),
          ),
        ),
        // 到了明细上限时差额是「被截掉的旧记录」，不是「更新前没记明细」，两种说法不能混用
        cap > 0 && rows.length >= cap
          ? h('div', { className: 'dsc-calls-note' }, t('calls.capped', { n: cap }))
          : backlog > 0
            ? h('div', { className: 'dsc-calls-note' }, t('calls.backlog', { n: backlog }))
            : null,
        !loaded
          ? null
          : rows.length === 0
            ? h('p', { className: 'dsc-field-hint' }, t('calls.empty'))
            : h(
                'div',
                { className: 'dsc-calls-list' },
                rows.map((row, index) =>
                  h(
                    'div',
                    { className: 'dsc-call', key: `${row.at}-${index}`, title: row.reason || '' },
                    h('span', { className: 'dsc-call-time' }, callTime(row.at)),
                    h('span', { className: 'dsc-call-title', title: row.title || row.sessionId }, row.title || row.sessionId || '—'),
                    h('span', { className: 'dsc-call-scope' }, t(`calls.scope.${row.scope}`)),
                    h('span', { className: 'dsc-call-outcome', 'data-on': row.outcome }, t(`calls.outcome.${row.outcome}`)),
                    h('span', { className: 'dsc-call-cost' }, `¥${Number(row.costCny ?? 0).toFixed(4)}`),
                  ),
                ),
              ),
      )
    }

    function SettingsView({ onClose }) {
      const state = useStore()
      const t = state.__t
      const data = state.data
      const saved = data?.settings ?? {}

      const baseline = useMemo(
        () => ({
          autoClassify: saved.autoClassify !== false,
          showRowMark: saved.showRowMark !== false,
          costRange: saved.costRange ?? 'day',
          // 'all' 表示整条会话；其余是「最近 N 轮」
          turnCount: saved.turnCount === 0 ? 'all' : String(saved.turnCount ?? 1),
          titleCheckEvery: numberDraft(saved.titleCheckEvery, 1),
          minConfidence: numberDraft(saved.minConfidence, 0.35),
          filterSort: saved.filterSort === 'activity' ? 'activity' : 'created',
        }),
        [saved],
      )
      const [draft, setDraft] = useState(baseline)
      const [saving, setSaving] = useState(false)

      const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
      const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

      const save = async () => {
        setSaving(true)
        const result = await mutate('/settings', {
          autoClassify: draft.autoClassify,
          showRowMark: draft.showRowMark,
          costRange: draft.costRange,
          turnCount: draft.turnCount === 'all' ? 0 : Math.max(1, Number(draft.turnCount) || 1),
          titleCheckEvery: Math.max(0, Number(draft.titleCheckEvery) || 0),
          minConfidence: Number(draft.minConfidence),
          filterSort: draft.filterSort,
        })
        setSaving(false)
        if (!result) return
        store.set({ data: { ...store.get().data, settings: result.settings } })
        toast(t('panel.saved'))
        onClose?.()
      }

      /** 一组设置：小标题 + 一条分隔线，同类的放一起。 */
      const section = (titleKey, children) =>
        h('section', { className: 'dsc-section' }, h('h3', null, t(titleKey)), children)

      const switchRow = (labelKey, hintKey, field) =>
        h(
          'div',
          { className: 'dsc-field-row' },
          h(
            'label',
            null,
            h('span', null, t(labelKey)),
            hintKey ? h('span', { className: 'dsc-field-hint' }, t(hintKey)) : null,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsc-switch',
              'data-on': draft[field] ? 'true' : 'false',
              onClick: () => set(field, !draft[field]),
            },
            h('i'),
          ),
        )

      const TURN_MAX = 20
      const turnValue = draft.turnCount === 'all' ? TURN_MAX : Number(draft.turnCount) || 1

      const turnRow = h(
        'div',
        { className: 'dsc-field-row' },
        h(
          'label',
          null,
          h('span', null, t('settings.turns')),
          h('span', { className: 'dsc-field-hint' }, t('settings.turnsHint')),
        ),
        h(
          'div',
          { className: 'dsc-slider' },
          h('input', {
            type: 'range',
            className: 'dsc-range',
            min: 1,
            max: TURN_MAX,
            step: 1,
            value: turnValue,
            disabled: draft.turnCount === 'all',
            'aria-label': t('settings.turns'),
            onChange: (event) => set('turnCount', String(event.target.value)),
          }),
          h(
            'span',
            { className: 'dsc-slider-value' },
            draft.turnCount === 'all' ? t('scope.all') : t('scope.turns', { n: draft.turnCount }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsc-scope-all',
              'data-on': draft.turnCount === 'all' ? 'true' : 'false',
              onClick: () => set('turnCount', draft.turnCount === 'all' ? String(TURN_MAX) : 'all'),
            },
            t('scope.all'),
          ),
        ),
      )

      const TITLE_MAX = 20
      const titleValue = Math.min(TITLE_MAX, Math.max(0, Number(draft.titleCheckEvery) || 0))
      const titleRow = h(
        'div',
        { className: 'dsc-field-row' },
        h(
          'label',
          null,
          h('span', null, t('settings.titleCheck')),
          h('span', { className: 'dsc-field-hint' }, t('settings.titleCheckHint')),
        ),
        h(
          'div',
          { className: 'dsc-slider' },
          h('input', {
            type: 'range',
            className: 'dsc-range',
            min: 0,
            max: TITLE_MAX,
            step: 1,
            value: titleValue,
            'aria-label': t('settings.titleCheck'),
            onChange: (event) => set('titleCheckEvery', event.target.value),
          }),
          h(
            'span',
            { className: 'dsc-slider-value' },
            titleValue === 0 ? t('settings.off') : t('settings.everyTurns', { n: titleValue }),
          ),
        ),
      )

      const confidenceRow = h(
        'div',
        { className: 'dsc-field-row' },
        h(
          'label',
          null,
          h('span', null, t('settings.confidence')),
          h('span', { className: 'dsc-field-hint' }, t('settings.confidenceHint')),
        ),
        h('input', {
          className: 'dsc-num',
          inputMode: 'decimal',
          value: draft.minConfidence,
          onChange: (event) => set('minConfidence', event.target.value),
        }),
      )

      const costRow = h(
        'div',
        { className: 'dsc-field-row' },
        h('label', null, h('span', null, t('settings.costRange'))),
        h(
          'div',
          { className: 'dsc-seg', style: { marginLeft: 0 } },
          ['day', 'week', 'month'].map((item) =>
            h(
              'button',
              {
                key: item,
                type: 'button',
                'data-on': draft.costRange === item ? 'true' : 'false',
                onClick: () => set('costRange', item),
              },
              t(`range.${item}`),
            ),
          ),
        ),
      )

      // 只影响侧边栏那份「选分类」清单的顺序：分类页仍按活跃度
      const filterSortRow = h(
        'div',
        { className: 'dsc-field-row' },
        h(
          'label',
          null,
          h('span', null, t('settings.filterSort')),
          h('span', { className: 'dsc-field-hint' }, t('settings.filterSortHint')),
        ),
        h(
          'div',
          { className: 'dsc-seg', style: { marginLeft: 0 } },
          ['created', 'activity'].map((item) =>
            h(
              'button',
              {
                key: item,
                type: 'button',
                'data-on': draft.filterSort === item ? 'true' : 'false',
                onClick: () => set('filterSort', item),
              },
              t(`filterSort.${item}`),
            ),
          ),
        ),
      )

      const callsRow = h(
        'div',
        { className: 'dsc-field-row' },
        h('label', null, h('span', null, t('calls.title'))),
        h(
          'button',
          { type: 'button', className: 'dsc-btn', onClick: () => store.set({ callsOpen: true }) },
          t('calls.open'),
        ),
      )

      return h(
        'div',
        { className: 'dsc-settings' },
        section('settings.group.basic', [
          switchRow('settings.ai', 'settings.aiHint', 'autoClassify'),
          switchRow('settings.mark', 'settings.markHint', 'showRowMark'),
          filterSortRow,
        ]),
        section('settings.group.judge', [turnRow, confidenceRow]),
        section('settings.group.title', [titleRow]),
        section('settings.group.cost', [costRow, callsRow]),
        h(
          'div',
          { className: 'dsc-settings-actions' },
          dirty ? h('span', { className: 'dsc-field-hint' }, t('settings.dirty')) : null,
          h('button', { className: 'dsc-btn', type: 'button', onClick: onClose, disabled: saving }, t('settings.cancel')),
          h('button', { className: 'dsc-btn primary', type: 'button', onClick: save, disabled: saving }, t('settings.save')),
        ),
      )
    }

    // ------------------------------------------------------------ 会话行：移动按钮

    function SessionCategoryAction({ sessionId, displayTitle }) {
      const state = useStore()
      return h(
        'button',
        {
          className: 'dsc-action',
          title: state.data ? state.data.categories.length + ' categories' : '',
          'aria-label': 'Move to category',
          onClick: (event) => {
            event.stopPropagation()
            event.preventDefault()
            store.set({ moveTarget: { sessionId, displayTitle, x: event.clientX, y: event.clientY } })
          },
        },
        h(MoveIcon),
      )
    }

    // ------------------------------------------------------------ 移动对话框

    function MoveToCategoryDialog() {
      const state = useStore()
      const target = state.moveTarget
      const data = state.data
      const dialogRef = useRef(null)

      useEffect(() => {
        if (!target) return
        if (!data) refreshState()
        const onKey = (event) => {
          if (event.key === 'Escape') store.set({ moveTarget: null })
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [target, data])

      // 量一次真实尺寸再校正位置：列表长短不定，按固定 340 高度算会把弹窗顶出屏幕；
      // 位置偏差用位移补偿（而不是重算坐标），即使外层有 transform 也成立。
      useLayoutEffect(() => {
        const element = dialogRef.current
        const layer = element?.parentElement
        if (!element || !layer) return
        const box = layer.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        const margin = 12
        let dx = 0
        let dy = 0
        if (rect.right > box.right - margin) dx = box.right - margin - rect.right
        if (rect.bottom > box.bottom - margin) dy = box.bottom - margin - rect.bottom
        if (rect.left + dx < box.left + margin) dx = box.left + margin - rect.left
        if (rect.top + dy < box.top + margin) dy = box.top + margin - rect.top
        // 用 transform 做位移补偿：left/top 由 React 管，别两边抢同一个属性
        element.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`
      }, [target, data?.categories.length])

      if (!target || !data) return null
      const t = state.__t
      const current = categoryOf(data, null, target.sessionId)

      const close = () => store.set({ moveTarget: null })

      // 贴在触发点右侧弹出（像上下文菜单），不遮挡左边的会话列表
      const width = 340
      const anchorX = Number.isFinite(target.x) ? target.x : 260
      const anchorY = Number.isFinite(target.y) ? target.y : 200
      const left = Math.max(12, Math.min(anchorX + 14, window.innerWidth - width - 12))
      const top = Math.max(12, Math.min(anchorY - 44, window.innerHeight - 340))

      return h(
        'div',
        {
          className: 'dsc-overlay',
          onClick: (event) => {
            if (event.target === event.currentTarget) close()
          },
        },
        h(
          'div',
          {
            className: 'dsc-modal dsc-modal-anchored',
            role: 'dialog',
            'aria-modal': 'true',
            ref: dialogRef,
            style: { left: `${left}px`, top: `${top}px` },
          },
          h('h2', null, t('dialog.title')),
          h(
            'div',
            { className: 'dsc-modal-list' },
            data.categories
              .filter((category) => !category.archived)
              .map((category) =>
                h(
                  'button',
                  {
                    key: category.id,
                    className: 'dsc-modal-item',
                    onClick: async () => {
                      await assign(target.sessionId, category.id)
                      close()
                    },
                  },
                  h('i', { className: 'dsc-dot', style: { background: category.color } }),
                  h('span', { style: { flex: '1 1 auto' } }, category.name),
                  current?.id === category.id ? h('span', { className: 'dsc-row-meta' }, '✓') : null,
                ),
              ),
            current
              ? h(
                  'button',
                  {
                    className: 'dsc-modal-item',
                    onClick: async () => {
                      await assign(target.sessionId, '')
                      close()
                    },
                  },
                  h('i', { className: 'dsc-dot', style: { background: 'var(--dsw-alias-border-l2)' } }),
                  h('span', null, t('dialog.uncategorized')),
                )
              : null,
          ),
          h(
            'div',
            { className: 'dsc-modal-actions' },
            h('button', { className: 'dsc-btn ghost', onClick: close }, t('dialog.cancel')),
          ),
        ),
      )
    }

    // ------------------------------------------------------------ 会话标题：手动重新生成

    function TitleIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4 16.5z' }),
        h('path', { d: 'M13.5 6.5L17.5 10.5' }),
      )
    }

    /** 菜单项：打开「重新生成标题」弹窗。 */
    function MenuRegenerateTitle({ sessionId, displayTitle }) {
      const t = useStore().__t
      return h(
        'button',
        {
          role: 'menuitem',
          className: 'dsc-menu-item',
          onClick: () => openAfterMenuCloses({ titleTarget: { sessionId, displayTitle } }),
        },
        h(TitleIcon),
        h('span', null, t('menu.regenerateTitle')),
      )
    }

    /** 弹窗：先让模型给一个建议，允许手改，确认后走官方 rename。 */
    function TitleDialog() {
      const state = useStore()
      const t = state.__t
      const target = state.titleTarget
      const [current, setCurrent] = useState('')
      const [value, setValue] = useState('')
      const [phase, setPhase] = useState('loading')
      const [noSuggestion, setNoSuggestion] = useState(false)
      const [error, setError] = useState('')
      const [saving, setSaving] = useState(false)
      const inputRef = useRef(null)

      // 会话没有正式标题事件时，列表里的显示标题可能带「(1)」这类去重后缀，不能写进真标题
      const fallbackTitle = (target?.displayTitle || '').replace(/\s*\(\d+\)$/, '')

      useEffect(() => {
        if (!target) return undefined
        let cancelled = false
        setPhase('loading')
        setError('')
        setValue('')
        setCurrent('')
        setNoSuggestion(false)
        request('/title', {
          method: 'POST',
          body: JSON.stringify({ action: 'suggest', sessionId: target.sessionId }),
        })
          .then((result) => {
            if (cancelled) return
            setCurrent(result?.current || fallbackTitle)
            // 模型没给出不同标题时，直接把当前标题放进输入框，让用户自己改
            setValue(result?.title || result?.current || fallbackTitle)
            setNoSuggestion(!result?.title)
            setPhase('ready')
            requestAnimationFrame(() => {
              inputRef.current?.focus()
              inputRef.current?.select()
            })
          })
          .catch((err) => {
            if (cancelled) return
            setError(err.message)
            setPhase('error')
          })
        return () => {
          cancelled = true
        }
      }, [target, fallbackTitle])

      if (!target) return null
      const close = () => store.set({ titleTarget: null })

      const save = async () => {
        const title = value.trim()
        if (!title) return
        setSaving(true)
        const result = await mutate('/title', { action: 'accept', sessionId: target.sessionId, title })
        setSaving(false)
        if (!result) return
        store.set({ titleTarget: null })
        refreshState()
      }

      return h(
        'div',
        {
          className: 'dsc-overlay',
          onClick: (event) => {
            if (event.target === event.currentTarget) close()
          },
        },
        h(
          'div',
          { className: 'dsc-modal dsc-modal-center', role: 'dialog', 'aria-modal': 'true' },
          h('h2', null, t('title.title')),
          h('p', { className: 'dsc-field-hint' }, current || fallbackTitle || ''),
          noSuggestion && phase === 'ready'
            ? h('p', { className: 'dsc-field-hint' }, t('title.noSuggestion'))
            : null,
          phase === 'loading' ? h('div', { className: 'dsc-empty' }, t('title.loading')) : null,
          phase === 'error' ? h('div', { className: 'dsc-empty' }, error) : null,
          phase === 'ready'
            ? h('input', {
                className: 'dsc-input',
                ref: inputRef,
                value,
                placeholder: t('title.placeholder'),
                style: { width: '100%' },
                onChange: (event) => setValue(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') close()
                  if (event.key === 'Enter') save()
                },
              })
            : null,
          h(
            'div',
            { className: 'dsc-modal-actions', style: { gap: '8px' } },
            h('button', { className: 'dsc-btn ghost', onClick: close }, t('title.cancel')),
            h(
              'button',
              {
                className: 'dsc-btn primary',
                disabled: saving || phase !== 'ready' || !value.trim(),
                onClick: save,
              },
              t('title.save'),
            ),
          ),
        ),
      )
    }

    // ------------------------------------------------------------ 原生会话「...」菜单里的一行

    /**
     * 从原生右键菜单里打开我们自己的浮层。
     *
     * 两层浮层叠在一起时，原生菜单的层级更高，会把我们的弹窗压住（标题都看不见）。
     * 菜单在点完条目后由它自己卸载，所以这里等它消失再开（最多等 300ms）；
     * 顺手在点中的条目上发一个 Escape（菜单自己监听 Escape，能更快关掉；
     * 此刻我们的弹窗还没挂载，不会被自己的 Escape 处理误关）。
     */
    function openAfterMenuCloses(patch) {
      try {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      } catch {
        /* 合成事件失败就只靠等待 */
      }
      const started = Date.now()
      const tick = () => {
        const menu = document.querySelector('[role="menu"]')
        if (!menu || Date.now() - started > 300) {
          store.set(patch)
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    function MenuMoveToCategory({ sessionId, displayTitle }) {
      const state = useStore()
      const t = state.__t
      return h(
        'button',
        {
          role: 'menuitem',
          className: 'dsc-menu-item',
          onClick: (event) =>
            openAfterMenuCloses({ moveTarget: { sessionId, displayTitle, x: event.clientX, y: event.clientY } }),
        },
        h(MoveIcon),
        h('span', null, t('menu.moveTo')),
      )
    }

    // ------------------------------------------------------------ 输入框旁的自动分类提示

    /**
     * 建议直接画在输入框工具行里（就是 `+`、权限那一行）。
     *
     * 之前把卡片浮在 overlay 上、靠量输入框坐标定位，位置一直不稳（量不到 / 外层 transform /
     * 单位搞错都会跑到屏幕顶上）。工具行本来就是「放控件」的地方，塞一个小 chip 进去最简单：
     * 不会盖住输入框，也不会飘到别处。要一次看完所有建议，用面板顶部的「待处理建议」。
     */
    function AutoClassifyHintChip({ sessionId }) {
      const state = useStore()
      const t = state.__t
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        refreshHints()
      }, [])

      const raw = sessionId ? state.hints?.[sessionId] : undefined
      const candidates = Array.isArray(raw?.candidates) ? raw.candidates : []
      const views = candidates
        .map((candidate) => ({
          ...candidate,
          category: (state.hintCategories ?? []).find((c) => c.id === candidate.categoryId),
        }))
        .filter((item) => item.category)
      const titleHint = sessionId ? state.titleHints?.[sessionId] : undefined

      if (views.length === 0 && !titleHint) return null

      const acceptCategory = async (categoryId) => {
        setBusy(true)
        const result = await mutate('/hint', { action: 'accept', sessionId, categoryId })
        setBusy(false)
        if (!result) return
        const hints = { ...store.get().hints }
        delete hints[sessionId]
        store.set({ hints })
        refreshState()
      }

      const dismissCategory = async () => {
        setBusy(true)
        const result = await mutate('/hint', { action: 'dismiss', sessionId })
        setBusy(false)
        if (!result) return
        const hints = { ...store.get().hints }
        delete hints[sessionId]
        store.set({ hints })
      }

      const respondTitle = async (action) => {
        setBusy(true)
        const result = await mutate('/title', { action, sessionId, title: titleHint?.title })
        setBusy(false)
        if (!result) return
        const titleHints = { ...store.get().titleHints }
        delete titleHints[sessionId]
        store.set({ titleHints })
        if (action === 'accept') refreshState()
      }

      const chips = []

      if (views.length > 0) {
        chips.push(
          h(
            'span',
            { className: 'dsc-sug', key: 'category' },
            h('span', { className: 'dsc-sug-label' }, t('hint.chipLabel')),
            views.map((item) =>
              h(
                'button',
                {
                  key: item.categoryId,
                  className: 'dsc-sug-btn',
                  disabled: busy,
                  title: t('hint.text', { name: item.category.name }),
                  onClick: () => acceptCategory(item.categoryId),
                },
                h('i', { className: 'dsc-dot', style: { background: item.category.color, width: 7, height: 7 } }),
                h('span', null, item.category.name),
              ),
            ),
            h(
              'button',
              { className: 'dsc-sug-x', disabled: busy, title: t('hint.dismiss'), onClick: dismissCategory },
              '✕',
            ),
          ),
        )
      }

      if (titleHint) {
        chips.push(
          h(
            'span',
            { className: 'dsc-sug', key: 'title' },
            h('span', { className: 'dsc-sug-label' }, t('hint.titleLabel')),
            h(
              'button',
              { className: 'dsc-sug-btn', disabled: busy, title: titleHint.title, onClick: () => respondTitle('accept') },
              h('span', { className: 'dsc-sug-text' }, titleHint.title),
            ),
            h(
              'button',
              { className: 'dsc-sug-x', disabled: busy, title: t('hint.dismissTitle'), onClick: () => respondTitle('dismiss') },
              '✕',
            ),
          ),
        )
      }

      return h('span', { className: 'dsc-sug-row' }, chips)
    }

    // ------------------------------------------------------------ 插件入口

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-categories: dictionaries')
      const t = ctx.locale.bind(NS)
      // 组件通过 store 读翻译函数，避免每个组件都绑定一次
      store.set({ __t: t, __locale: (() => { try { return ctx.locale.getLocale?.().id ?? 'zh' } catch { return 'zh' } })() })

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-session-categories', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'session-categories: styles')

      // 打开会话：主面板与会话行共用一个入口
      const openSession = (sessionId) => {
        try {
          ctx.uiWorkspace.openSession(sessionId)
        } catch (error) {
          console.warn('[session-categories] openSession failed:', error)
        }
        // 分类弹窗占着主面板，不切回去的话点了会话「看起来没反应」
        try {
          ctx.layout.selectPanel('conversation')
        } catch {
          /* layout 不可用时保持原样 */
        }
      }
      store.set({ __openSession: openSession })

      /** 关掉分类弹窗：主区域退回对话面板。 */
      const closePanel = () => {
        try {
          ctx.layout.selectPanel('conversation')
        } catch {
          /* 极端情况下 layout 不可用时保持原样 */
        }
      }

      // 启动只拉轻量的 /hints（含分类 + 归属 + 设置），不扫会话清单。
      // 会话清单要等真正打开面板 / 筛选清单时再拉 —— 见 refreshState 的注释。
      refreshHints()

      // 首屏画完之后再空闲预热一次会话清单（约 1.7 秒 I/O）：
      // 用户绝大多数操作是先看列表、再点分类图标，等他点下去时通常已经热了。
      // 用 requestIdleCallback，页面忙的时候不会抢首屏。
      ctx.effect(() => {
        let timer = 0
        let idleId = 0
        const run = () => {
          if (document.visibilityState !== 'visible') return
          warmSessionList()
        }
        if (typeof window.requestIdleCallback === 'function') {
          idleId = window.requestIdleCallback(run, { timeout: 4000 })
        } else {
          timer = setTimeout(run, 1500)
        }
        return () => {
          if (timer) clearTimeout(timer)
          if (idleId && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
        }
      }, 'session-categories: warm-up')

      // 提示条需要及时性：20 秒一轮轻量轮询；页面隐藏时不拉。
      ctx.effect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState !== 'visible') return
          refreshHints()
        }, 20000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') refreshHints()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, 'session-categories: hint polling')

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: () => t('panel.title'),
          },
          CategoryIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ openSession, closePanel }),
          },
          CategoriesPanel,
        ),
      )

      ctx.slots.inject('sidebar.session.row.leading', () =>
        ctx.slots.register(
          {
            name: 'sidebar.session.row.leading',
            id: 'session-category-mark',
            order: 20,
          },
          SessionCategoryMark,
        ),
      )

      ctx.slots.inject('sidebar.session.row.hover', () =>
        ctx.slots.register(
          {
            name: 'sidebar.session.row.hover',
            id: 'session-category-hover',
            order: 20,
          },
          SessionCategoryHover,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'session-category',
            order: 350,
          },
          MenuMoveToCategory,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'session-title',
            order: 340,
          },
          MenuRegenerateTitle,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.row.action',
            id: 'session-category-move',
            order: 150,
          },
          SessionCategoryAction,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-category-move-dialog',
          },
          MoveToCategoryDialog,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-title-dialog',
          },
          TitleDialog,
        ),
      )

      // 建议直接塞进输入框工具行：不浮动、不量坐标，位置永远不会跑
      // 「按分类筛选」入口插在侧边栏「工作区」分区上方（原生没有这个位置的插槽）
      ctx.effect(() => {
        let guard = false
        const run = () => {
          if (guard) return
          guard = true
          try {
            applySidebarFilter(store.get())
          } catch (error) {
            console.warn('[dsh-session-categories] 侧边栏筛选应用失败：', error)
          } finally {
            guard = false
          }
        }
        run()
        const unsubscribe = store.subscribe(run)
        return () => {
          unsubscribe()
          clearFilter()
          const style = document.getElementById('dsh-session-categories-filter')
          if (style) style.textContent = ''
        }
      }, 'session-categories: sidebar filter')

      ctx.effect(() => {
        try {
          return mountSidebarFilterBar()
        } catch (error) {
          // 侧边栏注入属于「锦上添花」，出错也不能让整个插件挂掉
          console.warn('[dsh-session-categories] 侧边栏筛选入口注入失败：', error)
          return () => {}
        }
      }, 'session-categories: sidebar filter bar')

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-category-filter-panel',
          },
          SidebarFilterPanel,
        ),
      )

      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'session-category-hint',
            order: 0,
          },
          AutoClassifyHintChip,
        ),
      )

    }

    return {
      inject: ['slots', 'uiWorkspace', 'locale', 'layout'],
      apply,
    }
  },
})
