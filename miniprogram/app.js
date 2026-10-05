/**
 * app.js
 *
 * 唯一职责：全局初始化一次 wx.cloud。
 *
 * 关键点（官方文档）：
 *  - 用 wx.cloud.callContainer 之前「一定要 init 一下，全局执行一次即可」；
 *  - init 的 env 与云托管无关，留空即可；
 *  - 真正决定打到哪个云托管环境的是 callContainer 的 config.env（在 utils/api.js）。
 */
const api = require('./utils/api.js')

App({
  onLaunch() {
    // 全局一次。如果这次 init 的异步初始化还没完成，
    // utils/api.js 会在遇到 "Cloud API isn't enabled" 时自动等待重试（最多 3 次）。
    api.initCloud()
  },

  onError(err) {
    // 兜底日志，方便在开发者工具里定位问题
    console.error('[app onError]', err)
  },

  onUnhandledRejection(res) {
    console.error('[app onUnhandledRejection]', res && res.reason)
  },
})
