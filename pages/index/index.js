/**
 * pages/index/index.js —— 输入 → 去 AI 味 → 结果弹窗
 *
 * 流程（对应后端的「混合模式」）：
 *   1. POST /api/rewrite，后端先同步等最多 12 秒；
 *   2. 命中 → 直接带 status=done + llmText 返回，立刻弹窗；
 *   3. 没命中 → 只回 taskId（status=pending），这里继续轮询 /api/task/<id>。
 *
 * 轮询期间把 taskId 写进本地存储：小程序切后台 5 秒后请求会被系统杀掉，
 * 用户回来时还能接着等，不至于白等一场。
 */
const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const format = require('../../utils/format.js')
const config = require('../../config.js')

Page({
  data: {
    text: '',
    charCount: 0,
    maxChars: config.MAX_INPUT_CHARS,
    nearLimit: false, // 快到上限时把计数器变红
    loading: false,
    statusText: '',

    // 部署自检
    configOk: true,
    configHint: '',
    phoneAuthReady: false,

    // 额度
    quota: null,

    // 改写参数。默认值先兜底，onLoad 后从 /api/skills 拉真实选项。
    skill: config.DEFAULT_SKILL,
    scene: config.DEFAULT_SCENE,
    intensity: config.DEFAULT_INTENSITY,
    // 后端返回的候选 key + 渲染用的选项（带中文名和选中态）
    sceneKeys: [],
    intensityKeys: [],
    sceneOptions: [],
    intensityOptions: [],

    // 结果弹窗
    showModal: false,
    modalRecord: null,
  },

  onLoad() {
    // 轮询用的中断信号，onUnload 时置 stopped
    this.poller = { stopped: false }

    this.setData({
      configOk: api.isConfigured(),
      configHint: api.configHint(),
    })
    if (!api.isConfigured()) return

    this.loadHealth()
    this.loadDefaults()
  },

  onShow() {
    if (!api.isConfigured()) return
    this.loadQuota()
    this.resumePending()
  },

  onUnload() {
    // 只是停止本页的轮询，任务本身还在后端跑，下次进来能续上
    this.poller.stopped = true
  },

  /* ------------------------------ 数据加载 ------------------------------ */

  /** 部署自检：手机号授权是否就绪（决定要不要显示授权入口） */
  loadHealth() {
    const that = this
    api
      .health()
      .then(function (d) {
        that.setData({ phoneAuthReady: !!d.phoneAuthReady })
      })
      .catch(function (err) {
        // 探活失败不打扰用户，首次真正提交时会给出明确报错
        console.warn('[index] health 失败：', err)
      })
  },

  /**
   * 改写参数从后端拉，前端不写死。
   *
   * 场景列表优先用「当前 skill 自己支持的」——全局 `d.scenes` 是所有场景的并集，
   * 将来某个 skill 只支持一部分时，用它会出现「选了但后端不认」的选项。
   */
  loadDefaults() {
    const that = this
    api
      .getSkills()
      .then(function (d) {
        const skills = Array.isArray(d.skills) ? d.skills : []
        const skill = d.default || config.DEFAULT_SKILL
        const entry = skills.filter(function (s) {
          return s && s.slug === skill
        })[0]

        const sceneKeys =
          (entry && entry.scenes && entry.scenes.length ? entry.scenes : d.scenes) || []
        const intensityKeys = d.intensities || []
        const defaultScene = (entry && entry.defaultScene) || config.DEFAULT_SCENE

        // 上次选的场景优先；如果它已经不在候选里（后端下线了），退回默认值
        const prefs = store.getPrefs()
        that.setData({
          skill: skill,
          sceneKeys: sceneKeys,
          intensityKeys: intensityKeys,
          scene: format.pick(prefs.scene, sceneKeys, defaultScene),
          intensity: format.pick(prefs.intensity, intensityKeys, config.DEFAULT_INTENSITY),
        })
        that.syncOptions()
      })
      .catch(function (err) {
        // 拉不到选项就把选择器藏起来（选项为空），而不是写死一份前端副本
        console.warn('[index] skills 失败，隐藏选择器、用默认参数：', err)
      })
  },

  /** 按当前的 scene / intensity 重算两组选项的选中态 */
  syncOptions() {
    this.setData({
      sceneOptions: format.buildSceneOptions(this.data.sceneKeys, this.data.scene),
      intensityOptions: format.buildIntensityOptions(this.data.intensityKeys, this.data.intensity),
    })
  },

  onSelectScene(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.scene) return
    this.setData({ scene: key })
    this.syncOptions()
    store.savePrefs({ scene: key })
  },

  onSelectIntensity(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.intensity) return
    this.setData({ intensity: key })
    this.syncOptions()
    store.savePrefs({ intensity: key })
  },

  loadQuota() {
    const that = this
    api
      .getQuota()
      .then(function (d) {
        that.setData({ quota: d })
      })
      .catch(function (err) {
        console.warn('[index] quota 失败：', err)
      })
  },

  /* ------------------------------ 输入区 ------------------------------ */

  onInput(e) {
    const value = e.detail.value || ''
    const n = format.countChars(value)
    this.setData({
      text: value,
      charCount: n,
      nearLimit: n >= this.data.maxChars,
    })
  },

  /** 粘贴：读剪贴板，超长自动截断并提示 */
  onPaste() {
    const that = this
    wx.getClipboardData({
      success(res) {
        const raw = String((res && res.data) || '')
        if (!raw.trim()) {
          wx.showToast({ title: '剪贴板是空的', icon: 'none' })
          return
        }
        const max = that.data.maxChars
        const clipped = format.countChars(raw) > max
        // 按 code unit 截断（和 textarea 的 maxlength 口径一致）
        let value = clipped ? raw.slice(0, max) : raw
        // 补一刀：上面按 code unit 切，可能把 emoji 的代理对切成半个，
        // 留下孤儿代理字符会让渲染出方块
        if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1)
        const n = format.countChars(value)
        that.setData({ text: value, charCount: n, nearLimit: n >= max })
        if (clipped) wx.showToast({ title: '内容过长，已截断到 ' + max + ' 字', icon: 'none' })
      },
      fail() {
        wx.showToast({ title: '读剪贴板失败，请长按输入框粘贴', icon: 'none' })
      },
    })
  },

  /** 复制输入框里当前的内容 */
  onCopyInput() {
    const text = this.data.text
    if (!text) {
      wx.showToast({ title: '还没输入内容', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: text })
  },

  onClear() {
    if (!this.data.text) return
    const that = this
    wx.showModal({
      title: '清空输入',
      content: '确定要清空当前内容吗？',
      confirmColor: '#C6483F',
      success(res) {
        if (res.confirm) that.setData({ text: '', charCount: 0, nearLimit: false })
      },
    })
  },

  /* ------------------------------ 提交 ------------------------------ */

  onSubmit() {
    if (this.data.loading) return

    const text = String(this.data.text || '').trim()
    if (!text) {
      wx.showToast({ title: '先输入要改写的文字', icon: 'none' })
      return
    }
    if (format.countChars(text) > this.data.maxChars) {
      wx.showToast({ title: '最多 ' + this.data.maxChars + ' 字', icon: 'none' })
      return
    }
    if (!api.isConfigured()) {
      this.alert('还没配置云托管', api.configHint())
      return
    }

    this.run(text)
  },

  run(text) {
    const that = this
    const opts = {
      skill: this.data.skill,
      scene: this.data.scene,
      intensity: this.data.intensity,
    }

    this.setData({ loading: true, statusText: '正在改写…' })

    api
      .createRewrite(text, opts)
      .then(function (first) {
        // 创建接口的返回里带 report 和 quota（轮询接口没有），要先留住
        that.applyQuota(first.quota)

        if (first.status === 'done' || first.status === 'failed') {
          that.setData({ loading: false, statusText: '' })
          that.finish(first, text, opts)
          return null
        }

        // status=pending：转到后台跑了，继续轮询
        const taskId = first.taskId
        if (!taskId) throw new Error('服务端没有返回 taskId')

        store.savePending({ taskId: taskId, at: Date.now(), text: text })
        that.setData({ statusText: 'AI 还在写，通常几秒…' })

        return api
          .pollTask(taskId, {
            signal: that.poller,
            onProgress: function () {},
          })
          .then(function (final) {
            // 用轮询结果覆盖 status/llmText/usage，保留 first 里的 report/quota
            that.finish(Object.assign({}, first, final), text, opts)
          })
          .catch(function (err) {
            if (err && err.code === 'LLM_ERROR' && err.data) {
              // 任务失败，但后端给了规则版兜底 —— 照样弹窗，别让用户白等
              that.finish(Object.assign({}, first, err.data), text, opts)
              return
            }
            throw err
          })
      })
      .catch(function (err) {
        if (err && err.code === 'CANCELLED') return // 页面已卸载，静默
        that.alertError(err)
      })
      .then(function () {
        // 只有走到终态才清 pending；被 CANCELLED 时留着，下次进来续上
        if (!that.poller.stopped) store.clearPending()
        that.setData({ loading: false, statusText: '' })
      })
  },

  /** 冷启动 / 切后台回来：把没跑完的任务接上 */
  resumePending() {
    if (this.data.loading) return
    const pending = store.getPending()
    if (!pending) return

    const that = this
    this.setData({ loading: true, statusText: '正在取回上次的改写…' })

    api
      .pollTask(pending.taskId, {
        signal: this.poller,
        onProgress: function () {},
      })
      .then(function (final) {
        that.finish(final, final.sourceText || pending.text || '', {
          skill: final.skill || that.data.skill,
          scene: final.scene || that.data.scene,
          intensity: final.intensity || that.data.intensity,
        })
      })
      .catch(function (err) {
        if (err && err.code === 'CANCELLED') return
        if (err && err.code === 'LLM_ERROR' && err.data) {
          that.finish(err.data, pending.text || '', {})
          return
        }
        // 超时/网络问题：不弹窗，免得刚进小程序就报错
        console.warn('[index] 续跑任务失败：', err)
      })
      .then(function () {
        if (!that.poller.stopped) store.clearPending()
        that.setData({ loading: false, statusText: '' })
      })
  },

  /* ------------------------------ 结果落地 ------------------------------ */

  applyQuota(quota) {
    if (quota && typeof quota === 'object') this.setData({ quota: quota })
  },

  /** 有结果了：存历史 + 弹窗 */
  finish(payload, sourceText, opts) {
    const p = payload || {}
    const report = format.decorateReport(p.report)
    const record = {
      id: p.taskId || '',
      createdAt: Date.now(),
      text: sourceText,
      skill: p.skill || (opts && opts.skill) || this.data.skill,
      scene: p.scene || (opts && opts.scene) || this.data.scene,
      intensity: p.intensity || (opts && opts.intensity) || this.data.intensity,
      rulesText: p.rulesText || '',
      llmText: p.llmText || '',
      report: p.report || null,
      score: report.score,
      level: p.report && p.report.level ? p.report.level : 'low',
      totalHits: report.totalHits,
      charCount: report.charCount || format.countChars(sourceText),
      usage: p.usage || null,
      error: p.error || '',
    }

    store.addHistory(record)
    this.setData({
      showModal: true,
      modalRecord: format.toModalRecord(record),
    })
  },

  onModalClose() {
    this.setData({ showModal: false })
  },

  /* ------------------------------ 报错 ------------------------------ */

  alert(title, content) {
    wx.showModal({
      title: title,
      content: content,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  alertError(err) {
    this.alert('没能改写', api.describeError(err))
  },

  /* ------------------------------ 手机号授权（额度 5 → 10）------------------------------ */

  /**
   * open-type="getPhoneNumber" 的回调。
   *
   * e.detail.code 是微信下发的一次性凭证（5 分钟有效、只能消费一次），
   * 与 wx.login 的 code 不能混用，所以传的是 phoneCode。
   * errno 1400001 = 小程序手机号资源包额度不足，此时不会有 code。
   */
  onPhoneAuth(e) {
    const detail = (e && e.detail) || {}

    if (detail.errno === 1400001) {
      wx.showToast({ title: '授权服务额度不足，请稍后再试', icon: 'none' })
      return
    }
    if (!detail.code) {
      wx.showToast({ title: '已取消授权', icon: 'none' })
      return
    }

    const that = this
    wx.showLoading({ title: '授权中…', mask: true })
    api
      .login(detail.code)
      .then(function (d) {
        wx.hideLoading()
        that.applyQuota(d.quota)
        const limit = d.quota && d.quota.limit ? d.quota.limit : ''
        wx.showToast({
          title: limit ? '已提升到每天 ' + limit + ' 次' : '授权成功',
          icon: 'none',
        })
      })
      .catch(function (err) {
        wx.hideLoading()
        that.alert('授权失败', api.describeError(err))
      })
  },
})
