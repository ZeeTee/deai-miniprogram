#!/usr/bin/env node
/**
 * scripts/selfcheck.js —— 纯逻辑自检（不需要微信开发者工具，普通 node 就能跑）
 *
 *     cd deai-miniprogram && node scripts/selfcheck.js
 *
 * 为什么需要它：小程序代码没法在命令行里跑单测（Page/Component/wx 都是运行时的东西）。
 * 但真正容易出错的部分其实都是纯逻辑——字数统计、本地存储的增删改查与淘汰、
 * 选项构造、以及「请求报文和错误信封」的解析。这些都能用假的 wx 全局跑起来，
 * 所以本脚本桩掉 wx.*，把 miniprogram/utils/ 全部验一遍。
 *
 * ⚠️ 这个文件是 **Node 脚本**，不是小程序代码：它用 require('path')、process.exit、
 * async/await，这些在小程序运行时都不存在。所以它必须待在 miniprogramRoot
 * **之外**（本项目的 miniprogramRoot 是 miniprogram/），
 * 并且已在 project.config.json 的 packOptions.ignore 里排除，不会被上传。
 *
 * 它不会碰 config.js 里的真实配置（只在内存里改），也不会发任何网络请求。
 */

const path = require('path')

/* ------------------------------------------------------------------ *
 * 假的 wx 全局
 * ------------------------------------------------------------------ */

const mem = {} // 假的本地存储
const calls = [] // 记录每次 callContainer 的入参
let plan = [] // 每次 callContainer 的返回值队列

global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => {
    mem[k] = JSON.parse(JSON.stringify(v))
  },
  removeStorageSync: (k) => {
    delete mem[k]
  },
  cloud: {
    init: () => {},
    callContainer: (opt) => {
      calls.push(opt)
      const next = plan.shift()
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve({ statusCode: next.statusCode || 200, data: next.body })
    },
  },
}

const dir = path.join(__dirname, '..', 'miniprogram')
const store = require(path.join(dir, 'utils/store.js'))
const format = require(path.join(dir, 'utils/format.js'))
const config = require(path.join(dir, 'config.js'))
const api = require(path.join(dir, 'utils/api.js'))

// 用测试值覆盖占位符（只改内存，不写回文件）
config.CLOUD_ENV = 'prod-selfcheck'
config.SERVICE_NAME = 'deai-api'

/* ------------------------------------------------------------------ *
 * 断言
 * ------------------------------------------------------------------ */

let fails = 0
let checks = 0

function check(name, cond, extra) {
  checks++
  if (cond) {
    console.log('  [OK]   ' + name)
  } else {
    console.log('  [FAIL] ' + name + (extra !== undefined ? '  <- ' + JSON.stringify(extra) : ''))
    fails++
  }
}

function section(title) {
  console.log('\n=== ' + title + ' ===')
}

const ok = (body) => ({ body: { ok: true, data: body } })
const err = (statusCode, code, message) => ({
  statusCode,
  body: { ok: false, error: { code, message } },
})

/* ------------------------------------------------------------------ */

async function main() {
  /* ---------------- 字数 ---------------- */
  section('字数统计（按用户直觉，emoji 算 1 个）')
  check('纯中文', format.countChars('一二三四五') === 5)
  check('emoji 代理对算一个', format.countChars('😀') === 1, format.countChars('😀'))
  check('混合文本', format.countChars('a😀中') === 3, format.countChars('a😀中'))
  check('换行也算一个', format.countChars('a\nb') === 3)
  check('空串', format.countChars('') === 0)

  /* ---------------- 历史记录 ---------------- */
  section('历史记录：增删改查')
  const rec = store.addHistory({
    id: 'task1',
    text: '首先，我们要明确目标。其次，不断优化。',
    skill: 'humanizer',
    scene: 'general',
    intensity: 'medium',
    rulesText: '规则版',
    llmText: 'AI 版',
    report: {
      score: 82,
      level: 'high',
      totalHits: 3,
      charCount: 20,
      hits: [{ text: '首先', severity: 'high', kind: 'replace' }],
    },
    score: 82,
    level: 'high',
    totalHits: 3,
    charCount: 20,
  })
  check('返回带 id / createdAt', rec.id === 'task1' && !!rec.createdAt)
  check('索引 1 条', store.getHistoryIndex().length === 1)
  check('明细可读回', store.getHistoryItem('task1').llmText === 'AI 版')
  check(
    '索引带结果摘要（优先 AI 版）',
    store.getHistoryIndex()[0].resultSummary === 'AI 版',
    store.getHistoryIndex()[0].resultSummary,
  )

  /* ---------------- 弹窗记录 ---------------- */
  section('弹窗记录（toModalRecord）')
  const modal = format.toModalRecord(store.getHistoryItem('task1'))
  check('title', modal.title === '改写结果', modal.title)
  check('isFallback=false', modal.isFallback === false)
  check('result 取 AI 版', modal.result === 'AI 版')
  check('source 是原文', modal.source.indexOf('首先') === 0)
  check('report 已加工（等级→色块）', modal.report.score === 82 && modal.report.levelChip === 'chip-high')
  check('meta 含场景与强度', modal.meta.indexOf('通用') === 0 && modal.meta.indexOf('中度') !== -1, modal.meta)

  section('弹窗记录：AI 失败时的规则版兜底')
  store.addHistory({
    id: 'task2',
    text: '原文',
    rulesText: '规则版兜底',
    llmText: '',
    report: null,
    error: 'AI 这次没写好',
  })
  const m2 = format.toModalRecord(store.getHistoryItem('task2'))
  check('title 变「规则版结果」', m2.title === '规则版结果', m2.title)
  check('isFallback=true', m2.isFallback === true)
  check('error 带出去', m2.error === 'AI 这次没写好')
  check('report 为 null', m2.report === null)
  check('列表里标记 hasLlm=false', store.getHistoryIndex()[0].hasLlm === false)
  check(
    '只有规则版时结果摘要退回规则版',
    store.getHistoryIndex()[0].resultSummary === '规则版兜底',
    store.getHistoryIndex()[0].resultSummary,
  )

  section('历史记录：更新与删除')
  store.updateHistory('task2', { llmText: '补上的 AI 版' })
  check('更新生效', store.getHistoryItem('task2').llmText === '补上的 AI 版')
  check('索引同步 hasLlm', store.getHistoryIndex()[0].hasLlm === true)
  store.removeHistory('task2')
  check('删除后剩 1 条', store.getHistoryIndex().length === 1)
  check('明细 key 也删了', store.getHistoryItem('task2') === null)

  section('历史记录：50 条上限淘汰')
  for (let i = 0; i < 60; i++) store.addHistory({ text: '第 ' + i + ' 条', llmText: 'r' + i })
  check('索引封顶 50', store.getHistoryIndex().length === 50, store.getHistoryIndex().length)
  const itemKeys = Object.keys(mem).filter((k) => k.indexOf('deai_history_item_v1_') === 0)
  check('明细 key 也是 50（没越存越多）', itemKeys.length === 50, itemKeys.length)
  check('最早的明细真的被删了', store.getHistoryItem(rec.id) === null)

  /* ---------------- 参数偏好 ---------------- */
  section('参数偏好（记住上次选择）')
  check('初始为空对象', JSON.stringify(store.getPrefs()) === '{}', store.getPrefs())
  store.savePrefs({ scene: 'academic' })
  store.savePrefs({ intensity: 'heavy' })
  const prefs = store.getPrefs()
  check('合并而不是覆盖', prefs.scene === 'academic' && prefs.intensity === 'heavy', prefs)

  /* ---------------- 选项构造 ---------------- */
  section('场景 / 强度选项')
  const scenes = ['general', 'xhs', 'academic', 'official']
  const sceneOpts = format.buildSceneOptions(scenes, 'xhs')
  check('4 个场景', sceneOpts.length === 4)
  check('中文名正确', sceneOpts.map((o) => o.label).join('/') === '通用/小红书/学术/公文')
  check('只有当前项 active', sceneOpts.filter((o) => o.active).length === 1 && sceneOpts[1].active)
  const intOpts = format.buildIntensityOptions(['light', 'medium', 'heavy'], 'medium')
  check('3 档强度 + 中文名', intOpts.map((o) => o.label).join('/') === '轻度/中度/重度')
  check(
    '后端加了新场景时显示原始 key 而不是空白',
    format.buildSceneOptions(['general', 'weibo'], 'general')[1].label === 'weibo',
  )

  section('参数合法性（本地存的值可能已被后端下线）')
  check('有效值采用', format.pick('xhs', scenes, 'general') === 'xhs')
  check('已下线退回默认', format.pick('weibo', scenes, 'general') === 'general')
  check('空值用默认', format.pick('', scenes, 'general') === 'general')
  check('默认也不合法就用第一个', format.pick('weibo', scenes, 'nope') === 'general')
  check('候选为空不炸', format.pick('xhs', [], 'general') === 'general')

  /* ---------------- 请求报文 ---------------- */
  section('请求报文与信封拆解')
  plan = [
    ok({
      taskId: 't1',
      status: 'done',
      llmText: 'AI 版',
      rulesText: '规则版',
      report: { score: 80 },
      quota: { used: 1, limit: 5, remaining: 4 },
    }),
  ]
  const done = await api.createRewrite('原文', { skill: 'humanizer', scene: 'xhs', intensity: 'heavy' })
  const c0 = calls[0]
  check('config.env = 环境ID', c0.config.env === 'prod-selfcheck', c0.config)
  check('header 带 X-WX-SERVICE', c0.header['X-WX-SERVICE'] === 'deai-api', c0.header)
  check('path = /api/rewrite + POST', c0.path === '/api/rewrite' && c0.method === 'POST')
  check(
    'body 字段名与后端一致（text/skill/mode/intensity）',
    c0.data.text === '原文' && c0.data.skill === 'humanizer' && c0.data.mode === 'xhs' && c0.data.intensity === 'heavy',
    c0.data,
  )
  check('timeout 不超过 15000', c0.timeout <= 15000, c0.timeout)
  check('信封拆包拿到 data', done.llmText === 'AI 版' && done.status === 'done')

  section('轮询：pending → done')
  calls.length = 0
  plan = [
    ok({ status: 'pending', taskId: 't2' }),
    ok({ status: 'pending', taskId: 't2' }),
    ok({ status: 'done', taskId: 't2', llmText: '最终结果' }),
  ]
  const final = await api.pollTask('t2', {})
  check('轮询到 done', final.status === 'done' && final.llmText === '最终结果')
  check('轮询路径与 GET', calls[1].path === '/api/task/t2' && calls[1].method === 'GET', calls[1].path)

  section('轮询：单次失败不判死（切后台被系统 kill）')
  const interrupted = new Error('fail')
  interrupted.errMsg = 'request:fail interrupted'
  plan = [interrupted, ok({ status: 'done', taskId: 't3', llmText: '还是成功了' })]
  const r3 = await api.pollTask('t3', {})
  check('interrupted 之后仍拿到结果', r3.llmText === '还是成功了')

  section('错误信封与传输层错误码')
  plan = [err(429, 'QUOTA_EXCEEDED', '今天的 5 次免授权额度用完了。授权手机号后每天可用 10 次')]
  try {
    await api.createRewrite('x', {})
    check('应抛错', false)
  } catch (e) {
    check('code = QUOTA_EXCEEDED', e.code === 'QUOTA_EXCEEDED', e.code)
    check('用后端的人话文案（含授权引导）', e.message.indexOf('授权手机号') !== -1, e.message)
  }
  const envErr = new Error('fail')
  envErr.errCode = -601027
  plan = [envErr]
  try {
    await api.health()
    check('应抛错', false)
  } catch (e) {
    check('-601027 → 环境ID 填错', e.message.indexOf('环境ID填错') !== -1, e.message)
  }

  section('没配置时直接拒绝，不发请求')
  const backupEnv = config.CLOUD_ENV
  config.CLOUD_ENV = 'REPLACE_ME_CLOUD_ENV'
  calls.length = 0
  try {
    await api.health()
    check('应抛错', false)
  } catch (e) {
    check('CONFIG_MISSING', e.code === 'CONFIG_MISSING', e.code)
    check('没有发出任何请求', calls.length === 0, calls.length)
  }
  config.CLOUD_ENV = backupEnv

  section('各接口路径')
  calls.length = 0
  plan = [ok({}), ok({}), ok({}), ok({})]
  await api.health()
  await api.getQuota()
  await api.getSkills()
  await api.login('phone-code')
  check('health', calls[0].path === '/api/health')
  check('quota', calls[1].path === '/api/quota')
  check('skills', calls[2].path === '/api/skills')
  check('login 字段是 phoneCode', calls[3].path === '/api/auth/login' && calls[3].data.phoneCode === 'phone-code')

  section('评价（/api/feedback）')
  calls.length = 0
  plan = [ok({ availableReasons: ['not_natural', 'added_facts', 'weird_new_reason'] })]
  const fbSummary = await api.getFeedbackSummary()
  check('summary 路径与 GET', calls[0].path === '/api/feedback/summary' && calls[0].method === 'GET')
  check('availableReasons 原样带出', fbSummary.availableReasons.length === 3, fbSummary.availableReasons)
  const reasonOpts = format.buildReasonOptions(fbSummary.availableReasons, 'added_facts')
  check('原因 key → 中文名', reasonOpts[0].label === '还是很像 AI', reasonOpts[0].label)
  check('只有选中项 active', reasonOpts.filter((o) => o.active).length === 1 && reasonOpts[1].active)
  check('后端新增的原因显示原始 key', reasonOpts[2].label === 'weird_new_reason', reasonOpts[2].label)

  plan = [ok({ accepted: true, created: true, rating: 'bad' })]
  const fb1 = await api.sendFeedback({
    taskId: 'task1',
    rating: 'bad',
    reason: 'not_natural',
    comment: '太长了',
  })
  check('提交到 /api/feedback（POST）', calls[1].path === '/api/feedback' && calls[1].method === 'POST')
  check(
    'taskId / rating / reason / comment 都带上',
    calls[1].data.taskId === 'task1' &&
      calls[1].data.rating === 'bad' &&
      calls[1].data.reason === 'not_natural' &&
      calls[1].data.comment === '太长了',
    calls[1].data,
  )
  check('created=true 带出（新建）', fb1.created === true)

  plan = [ok({ accepted: true, created: false, rating: 'good' })]
  await api.sendFeedback({ taskId: 'task1', rating: 'good' })
  check(
    '满意时不发 reason / comment（后端 reason 是枚举校验，空串非法）',
    calls[2].data.reason === undefined && calls[2].data.comment === undefined,
    calls[2].data,
  )
  check('只带 taskId 与 rating', Object.keys(calls[2].data).sort().join(',') === 'rating,taskId')

  plan = [ok({ accepted: true, created: true, rating: 'bad' })]
  await api.sendFeedback({ taskId: 'task1', rating: 'bad', comment: 'x'.repeat(1200) })
  check('comment 超过 1000 字会截断', calls[3].data.comment.length === 1000, calls[3].data.comment.length)

  section('评价入口：只有服务端任务才给')
  check('toModalRecord 带 taskId', modal.taskId === 'task1', modal.taskId)
  check('服务端任务可评价', modal.canFeedback === true)
  const localRec = store.addHistory({ text: '没有 taskId 的记录', llmText: '结果' })
  check('本地补 id 的记录标了 localOnly', localRec.localOnly === true && localRec.id.charAt(0) === 'h')
  check('本地记录不给评价入口', format.toModalRecord(localRec).canFeedback === false)

  section('待续跑任务')
  store.savePending({ taskId: 't9', at: 1, text: 'x' })
  check('savePending / getPending', store.getPending().taskId === 't9')
  store.clearPending()
  check('clearPending', store.getPending() === null)

  section('清空历史')
  store.clearHistory()
  check('索引清空', store.getHistoryIndex().length === 0)
  check('没有残留明细 key', Object.keys(mem).filter((k) => k.indexOf('item_v1_') === 0).length === 0)

  /* ---------------- 汇总 ---------------- */
  console.log('\n' + '='.repeat(56))
  if (fails) {
    console.log(`自检失败 ${fails} / ${checks} 项`)
    process.exit(1)
  }
  console.log(`全部通过 ✓ （${checks} 项）`)
}

main().catch((e) => {
  console.error('自检脚本自身出错：', e)
  process.exit(1)
})
