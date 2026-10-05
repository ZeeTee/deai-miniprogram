/**
 * 去 AI 味 · 前端配置文件
 *
 * ★ 整个项目只需要改这个文件 ★
 * 上面两项标了 REPLACE_ME 的必须改，否则请求一定会失败（页面会直接给提示）。
 * 改完保存，用微信开发者工具重新编译即可 —— 不需要构建，不需要 npm install。
 */
module.exports = {
  // 微信云托管的环境ID：控制台 → 云托管 → 环境设置 → 环境ID，形如 prod-xxxx
  // 注意填「环境ID」而不是环境名称，填错会报 errCode -601027 Environment not found
  CLOUD_ENV: 'REPLACE_ME_CLOUD_ENV',

  // 云托管的服务名：控制台 → 服务管理 → 服务列表 → 服务名称
  // 会作为请求头 X-WX-SERVICE 发出，填错会报 errCode -601031
  SERVICE_NAME: 'REPLACE_ME_SERVICE_NAME',

  // 输入上限（字）。后端默认上限是 5000，这里按产品要求收到 1000。
  // textarea 的 maxlength 直接用它，所以用户在输入阶段就被拦住，不会等到提交才报错。
  MAX_INPUT_CHARS: 1000,

  // 轮询参数。后端的「混合模式」会先同步等 12 秒，多数请求直接返回结果；
  // 超过 12 秒才需要前端自己轮询，所以这两个值不用调太小。
  POLL_INTERVAL_MS: 1200, // 每次轮询间隔
  POLL_TIMEOUT_MS: 90000, // 从创建任务算起的总时长上限

  // 默认改写参数。数值本身也从 /api/skills 拉，这里只是首屏渲染前的兜底。
  DEFAULT_SKILL: 'humanizer',
  DEFAULT_SCENE: 'general',
  DEFAULT_INTENSITY: 'medium',

  VERSION: '1.0.0',
}
