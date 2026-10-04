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
Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    // { title, source, result, isFallback, error, report, usage, meta }
    record: {
      type: Object,
      value: null,
    },
  },

  data: {
    showReport: false, // 「AI 味体检」详情是否展开
  },

  observers: {
    show: function (visible) {
      // 每次关闭都收起详情，下次打开是干净的
      if (!visible && this.data.showReport) this.setData({ showReport: false })
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
  },
})
