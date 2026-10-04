/**
 * pages/history/history.js —— 历史记录
 *
 * 数据全在本机（utils/store.js），不上传服务端：这个工具处理的是用户自己的文稿，
 * 没有理由把原文再存一份到服务器。
 *
 * 列表只读「轻量索引」，点开某一条才去读它的完整明细 —— 单条记录里含原文 +
 * 规则版 + AI 版 + 体检报告，一次性全读出来会很慢。
 */
const store = require('../../utils/store.js')
const format = require('../../utils/format.js')

Page({
  data: {
    list: [],
    total: 0,
    showModal: false,
    modalRecord: null,
  },

  onShow() {
    this.reload()
  },

  onPullDownRefresh() {
    this.reload()
    wx.stopPullDownRefresh()
  },

  reload() {
    const raw = store.getHistoryIndex()
    const list = raw.map(function (it) {
      const lv = format.levelInfo(it.level)
      return {
        id: it.id,
        summary: it.summary || '(空)',
        timeText: format.formatTime(it.createdAt),
        sceneText: format.sceneText(it.scene),
        charCount: it.charCount,
        score: it.score,
        scoreColor: lv.color,
        levelChip: lv.chip,
        levelText: lv.text,
        totalHits: it.totalHits,
        // 只有规则版 = AI 那次没跑成，列表上要标出来，别让人以为这就是 AI 改的
        isFallback: !it.hasLlm,
      }
    })
    this.setData({ list: list, total: list.length })
  },

  /** 点开一条：读完整明细再弹窗 */
  onTapItem(e) {
    const id = e.currentTarget.dataset.id
    const rec = store.getHistoryItem(id)
    if (!rec) {
      wx.showToast({ title: '这条记录已丢失', icon: 'none' })
      this.reload()
      return
    }
    this.setData({
      showModal: true,
      modalRecord: format.toModalRecord(rec),
    })
  },

  onLongPressItem(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showActionSheet({
      itemList: ['删除这条记录'],
      itemColor: '#C6483F',
      success(res) {
        if (res.tapIndex !== 0) return
        store.removeHistory(id)
        that.reload()
        wx.showToast({ title: '已删除', icon: 'none' })
      },
      fail() {
        // 用户取消，不用管
      },
    })
  },

  onClearAll() {
    if (!this.data.total) return
    const that = this
    wx.showModal({
      title: '清空历史记录',
      content: '会删掉本机保存的 ' + this.data.total + ' 条记录，无法恢复。',
      confirmText: '清空',
      confirmColor: '#C6483F',
      success(res) {
        if (!res.confirm) return
        store.clearHistory()
        that.reload()
        wx.showToast({ title: '已清空', icon: 'none' })
      },
    })
  },

  onModalClose() {
    this.setData({ showModal: false })
  },
})
