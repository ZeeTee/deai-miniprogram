/**
 * components/result-modal —— 结果弹窗
 *
 * 为什么不用 wx.showModal：它只能显示纯文本，用户**没法选中、没法复制**，
 * 而「把改写结果复制走」正是这个小程序唯一的出口动作。所以自己画一个。
 *
 * 用法：
 *   <result-modal show="{{showModal}}" record="{{modalRecord}}" bind:close="onModalClose" />
 *
 * record 的形状由页面归一化好再传进来，见 pages/index/index.js 的 buildModalRecord()。
 */
const api = require('../../utils/api.js')
const format = require('../../utils/format.js')

// 「不满意原因」的候选枚举按会话缓存一次：连着看几条结果时不用每次都问后端。
// 拉不到就留空 —— 原因本来就是选填，不能因为它挂了就挡住评价。
let reasonKeysCache = null

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    // { title, source, result, isFallback, error, report, meta }
    record: {
      type: Object,
      value: null,
    },
  },

  data: {
    showReport: false, // 「AI 味体检」详情是否展开

    // 反馈区状态：fbRating 是 '' | 'good' | 'bad'
    fbRating: '',
    fbReason: '',
    fbReasonText: '',
    fbComment: '',
    fbReasonOptions: [],
    fbSubmitting: false,
    fbSaved: false, // 这次弹窗里提交过没有（提交过就提示「可随时改」）
  },

  observers: {
    show: function (visible) {
      if (!visible) {
        // 每次关闭都收起详情，下次打开是干净的
        if (this.data.showReport) this.setData({ showReport: false })
        return
      }
      // 每次打开都是一条新的结果：反馈状态要重置，别把上一条的评价串到下一条上
      this.resetFeedback()
      this.loadFeedbackOptions()
    },
  },

  methods: {
    // 挡住气泡，避免点到面板内部时冒泡到遮罩把弹窗关掉
    noop: function () {},

    onClose: function () {
      this.triggerEvent('close')
    },

    toggleReport: function () {
      this.setData({ showReport: !this.data.showReport })
    },

    /**
     * 复制。data-which 决定复制结果还是原文。
     * 注意：wx.setClipboardData 成功后系统会自己弹一个「内容已复制」提示，
     * 不需要我们再 toast 一次（重复提示很吵）。
     */
    onCopy: function (e) {
      const which = e.currentTarget.dataset.which
      const rec = this.data.record || {}
      const text = which === 'source' ? rec.source : rec.result

      if (!text) {
        wx.showToast({ title: '没有可复制的内容', icon: 'none' })
        return
      }

      wx.setClipboardData({
        data: String(text),
        fail: function () {
          wx.showToast({ title: '复制失败，请长按文字手动复制', icon: 'none' })
        },
      })
    },

    /* ------------------------------ 反馈 ------------------------------ */

    resetFeedback: function () {
      this.setData({
        fbRating: '',
        fbReason: '',
        fbReasonText: '',
        fbComment: '',
        fbReasonOptions: [],
        fbSubmitting: false,
        fbSaved: false,
      })
    },

    /** 拉「不满意原因」的候选。失败就不显示原因，提交照样能用（原因是选填的） */
    loadFeedbackOptions: function () {
      const that = this
      if (reasonKeysCache) {
        this.setData({ fbReasonOptions: format.buildReasonOptions(reasonKeysCache, '') })
        return
      }
      api
        .getFeedbackSummary()
        .then(function (d) {
          // 约定后端给字符串数组；顺手兼容 [{key,label}] 的写法，别为这个炸掉
          const raw = (d && Array.isArray(d.availableReasons) ? d.availableReasons : []).map(
            function (item) {
              return typeof item === 'string' ? item : (item && item.key) || ''
            }
          )
          reasonKeysCache = raw.filter(Boolean)
          that.setData({ fbReasonOptions: format.buildReasonOptions(reasonKeysCache, '') })
        })
        .catch(function (err) {
          console.warn('[result-modal] feedback/summary 失败，原因列表留空：', err)
        })
    },

    /** 满意 / 不满意。满意不用再问理由，直接提交；不满意先展开原因和备注 */
    onRate: function (e) {
      if (this.data.fbSubmitting) return
      const rating = e.currentTarget.dataset.rating

      if (rating === 'good') {
        this.setData({ fbRating: 'good', fbReason: '', fbReasonText: '', fbComment: '' })
        this.submitFeedback('good')
        return
      }
      this.setData({ fbRating: 'bad' })
    },

    /** 原因单选：再点一次取消（原因是选填的） */
    onPickReason: function (e) {
      const key = e.currentTarget.dataset.key || ''
      const next = this.data.fbReason === key ? '' : key
      this.setData({
        fbReason: next,
        fbReasonText: next ? format.reasonText(next) : '',
        fbReasonOptions: format.buildReasonOptions(reasonKeysCache || [], next),
      })
    },

    onCommentInput: function (e) {
      this.setData({ fbComment: (e.detail && e.detail.value) || '' })
    },

    onSubmitBad: function () {
      this.submitFeedback('bad')
    },

    /**
     * 提交评价。同一任务同一用户只保留一条，重复提交 = 改主意，
     * 后端用 created=false 告诉我们这次是覆盖。
     */
    submitFeedback: function (rating) {
      const that = this
      const rec = this.data.record || {}

      if (!rec.taskId) {
        wx.showToast({ title: '这条记录没有任务 ID，暂时评价不了', icon: 'none' })
        return
      }

      this.setData({ fbSubmitting: true })
      api
        .sendFeedback({
          taskId: rec.taskId,
          rating: rating,
          // good 时后端会清空 reason，前端也不用带
          reason: rating === 'bad' ? this.data.fbReason : '',
          comment: rating === 'bad' ? this.data.fbComment : '',
        })
        .then(function (d) {
          that.setData({
            fbSubmitting: false,
            fbSaved: true,
            fbRating: (d && d.rating) || rating,
          })
          wx.showToast({
            title: d && d.created === false ? '已更新你的评价' : '谢谢你的反馈',
            icon: 'none',
          })
        })
        .catch(function (err) {
          that.setData({ fbSubmitting: false })
          wx.showToast({ title: api.describeError(err), icon: 'none' })
        })
    },
  },
})
