/** Copy of the settings section. Keys must match across languages (tested). */
export const en = {
  title: 'Model failure retry',
  description: 'Retry or switch models when a model request fails.',
  enabled: 'Enable',
  enabledHint: 'When off, failures are handled by DSH exactly as before.',
  rateLimit: 'Retry on rate limit',
  rateLimitHint: 'Short-window request or token limits (HTTP 429). Waits 5s, doubling, up to 60s, at most 5 retries.',
  transient: 'Retry on transient failure',
  transientHint: 'Upstream overload, 5xx, timeouts, dropped connections.',
  loading: 'Loading…',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The change was not accepted.',
};

export const zh = {
  title: '模型失败重试',
  description: '模型请求失败时自动重试或切换模型。',
  enabled: '启用',
  enabledHint: '关闭后，失败完全交给 DSH 按原有方式处理。',
  rateLimit: '限流重试',
  rateLimitHint: '短时间窗口内请求数或 token 数超额（HTTP 429）。等待 5 秒起、每次翻倍、最长 60 秒，最多 5 次。',
  transient: '临时故障重试',
  transientHint: '上游过载、5xx、超时、连接中断。',
  loading: '加载中…',
  unavailable: '该插件当前未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  saveFailed: '修改未被接受。',
};
