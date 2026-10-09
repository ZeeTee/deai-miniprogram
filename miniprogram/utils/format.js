/**
 * utils/format.js —— 纯函数：字数、时间、等级映射、报告加工
 * 不依赖 wx.*，方便单独复查逻辑。
 */

const LEVEL_MAP = {
  low: { text: '低', chip: 'chip-low', color: '#2E8B6E' },
  medium: { text: '中', chip: 'chip-medium', color: '#C77E22' },
  high: { text: '高', chip: 'chip-high', color: '#C6483F' },
}

const SEVERITY_MAP = {
  low: { text: '轻微', chip: 'chip-low' },
  medium: { text: '中度', chip: 'chip-medium' },
  high: { text: '严重', chip: 'chip-high' },
}

const SCENE_MAP = {
  general: '通用',
  xhs: '小红书',
  academic: '学术',
  official: '公文',
}

const INTENSITY_MAP = {
  light: '轻度',
  medium: '中度',
  heavy: '重度',
}

// 「不满意原因」的中文名。key 由后端 /api/feedback/summary 的 availableReasons 给，
// 这里只负责翻译；映射表里没有的 key 会原样显示，不会渲染成空白。
const REASON_MAP = {
  added_facts: '加了原文没有的内容',
  lost_info: '丢了原文的信息',
  not_natural: '还是很像 AI',
  changed_meaning: '意思被改了',
  too_casual: '改得太随意/口语',
  too_formal: '改得太正式',
  too_long: '变啰嗦了',
  too_short: '变短了',
  other: '其他',
}

/** 字数：按用户直觉数「字」，emoji 之类的代理对算一个 */
function countChars(text) {
  const s = String(text || '')
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    }
    n++
  }
  return n
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 时间戳 → 刚刚 / 12 分钟前 / 今天 20:06 / 09-28 20:06 */
function formatTime(ts) {
  const t = Number(ts) || 0
  if (!t) return ''
  const d = new Date(t)
  const now = new Date()
  const diff = now.getTime() - t

  if (diff >= 0 && diff < 60 * 1000) return '刚刚'
  if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'

  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return '今天 ' + hm

  const md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  if (d.getFullYear() === now.getFullYear()) return md + ' ' + hm
  return d.getFullYear() + '-' + md + ' ' + hm
}

function levelInfo(level) {
  return LEVEL_MAP[level] || LEVEL_MAP.low
}

function severityInfo(severity) {
  return SEVERITY_MAP[severity] || SEVERITY_MAP.low
}

function sceneText(scene) {
  return SCENE_MAP[scene] || SCENE_MAP.general
}

function intensityText(intensity) {
  return INTENSITY_MAP[intensity] || INTENSITY_MAP.medium
}

/** 按分数给一句人话结论（后端没给 verdict 时兜底） */
function scoreVerdict(score) {
  const s = Number(score) || 0
  if (s >= 70) return 'AI 味偏重，建议整段重写'
  if (s >= 40) return '有些机器腔，局部改一改就行'
  if (s > 0) return '整体像人写的，个别套话顺手删掉'
  return '没检出明显的 AI 痕迹'
}

/**
 * 把后端 report 加工成弹窗直接可用的形状。
 * 后端字段：score / level / totalHits / charCount / categories[] / hits[] / verdict / advice[]
 */
function decorateReport(report) {
  const r = report && typeof report === 'object' ? report : {}
  const score = typeof r.score === 'number' ? r.score : 0
  const level = r.level || 'low'
  const lv = levelInfo(level)

  const hits = (Array.isArray(r.hits) ? r.hits : []).map(function (h, i) {
    const sev = severityInfo(h && h.severity)
    return {
      key: 'h' + i,
      text: (h && h.text) || '',
      chip: sev.chip,
      severityText: sev.text,
      reason: (h && h.reason) || '',
      suggestion: (h && h.suggestion) || '',
      hasSuggestion: !!(h && h.suggestion),
    }
  })

  const backendVerdict = typeof r.verdict === 'string' ? r.verdict.trim() : ''

  return {
    score: score,
    levelText: lv.text,
    levelChip: lv.chip,
    scoreColor: lv.color,
    totalHits: typeof r.totalHits === 'number' ? r.totalHits : hits.length,
    charCount: typeof r.charCount === 'number' ? r.charCount : 0,
    hits: hits.slice(0, 8),
    hasHits: hits.length > 0,
    hitCount: hits.length,
    verdict: backendVerdict || scoreVerdict(score),
  }
}

/**
 * 把一条历史记录 / 任务结果归一化成 result-modal 需要的形状。
 * 首页和历史页共用，避免两边的弹窗字段慢慢跑偏。
 */
function toModalRecord(rec) {
  const r = rec && typeof rec === 'object' ? rec : {}
  const llm = r.llmText || ''
  const result = llm || r.rulesText || ''
  const hasReport = r.report && typeof r.report === 'object'

  const metaParts = []
  if (r.scene) metaParts.push(sceneText(r.scene))
  if (r.intensity) metaParts.push(intensityText(r.intensity))
  if (r.createdAt) metaParts.push(formatTime(r.createdAt))

  return {
    title: llm ? '改写结果' : r.error ? '规则版结果' : '改写结果',
    // 评价接口按 taskId 认任务；本地补过 id 的记录没有服务端任务，就不给它评价入口
    taskId: r.id || '',
    canFeedback: !!r.id && !r.localOnly,
    source: r.text || '',
    result: result,
    // 没拿到 AI 版但规则版有内容 = 兜底结果，要在弹窗里说清楚
    isFallback: !llm && !!r.rulesText,
    error: r.error || '',
    report: hasReport ? decorateReport(r.report) : null,
    meta: metaParts.join(' · '),
  }
}

/** 把后端给的 key 列表转成选择器用的选项（补中文名 + 选中态） */
function buildOptions(keys, labelMap, current) {
  return (Array.isArray(keys) ? keys : []).map(function (k) {
    return {
      key: k,
      label: labelMap[k] || k, // 后端加了新场景时，至少还能显示原始 key
      active: k === current,
    }
  })
}

function buildSceneOptions(keys, current) {
  return buildOptions(keys, SCENE_MAP, current)
}

function buildIntensityOptions(keys, current) {
  return buildOptions(keys, INTENSITY_MAP, current)
}

/** 不满意原因的中文名（未知 key 原样返回，和场景一样不留空白） */
function reasonText(reason) {
  return REASON_MAP[reason] || reason || ''
}

/** 不满意原因的候选（key 来自后端 /api/feedback/summary 的 availableReasons） */
function buildReasonOptions(keys, current) {
  return buildOptions(keys, REASON_MAP, current)
}

/** 只在候选列表里挑，挑不到就用兜底值（防止本地存了个后端已下线的场景） */
function pick(value, keys, fallback) {
  const list = Array.isArray(keys) ? keys : []
  if (value && list.indexOf(value) !== -1) return value
  if (fallback && list.indexOf(fallback) !== -1) return fallback
  return list[0] || fallback || value || ''
}

module.exports = {
  countChars: countChars,
  formatTime: formatTime,
  levelInfo: levelInfo,
  severityInfo: severityInfo,
  sceneText: sceneText,
  intensityText: intensityText,
  scoreVerdict: scoreVerdict,
  decorateReport: decorateReport,
  toModalRecord: toModalRecord,
  buildSceneOptions: buildSceneOptions,
  buildIntensityOptions: buildIntensityOptions,
  reasonText: reasonText,
  buildReasonOptions: buildReasonOptions,
  pick: pick,
}
