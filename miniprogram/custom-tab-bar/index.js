/**
 * custom-tab-bar —— 自定义 tabBar
 *
 * 为什么自己画：原生 tabBar 的文字大小是原生层写死的（app.json 没有 fontSize 配置，
 * WXSS 也够不到它），而需求是把「去 AI 味 / 历史记录」的字放大。自定义 tabBar 是官方给的唯一途径。
 *
 * 两个必须记住的点：
 *   1. app.json 的 tabBar 里仍然要留 list（custom: true 时它作为低版本兜底）；
 *   2. 每个 tab 页要在 onShow 里同步选中态 —— 自定义 tabBar 不会自己知道当前在哪一页。
 */
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '去 AI 味' },
      { pagePath: '/pages/history/history', text: '历史记录' },
    ],
  },

  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      // 点当前这一项不用再切一次，否则会白闪一下
      if (index === this.data.selected) return

      const item = this.data.list[index]
      if (!item) return

      // 先本地选中再切页：胶囊的滑动立刻开始，不用等新页面 onShow 回来，
      // 否则点完会先愣一下才动。onShow 里那次同步是幂等的，不冲突。
      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath })
    },
  },
})
