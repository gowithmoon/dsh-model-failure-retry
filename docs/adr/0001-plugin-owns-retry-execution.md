# 插件自行执行重试，不复用内置 llm-retry

内置 `llm-retry` 只支持"指数 × 上限 × 抖动"一种延迟算法，`Retry-After` 超过上限会直接放弃，也无法驱动我们的倒计时与停止按钮。因此对用户启用的失败类别，插件在 `agent/request-error` 上 prepend 监听并完全接管（不调用 `next()`），自己等待与重试；未启用的类别才交给内置重试，避免同一错误被重试两遍。

## Considered Options

- 像 dsh-llm-retry-settings 那样改写 `payload.retryPolicy` 后交给内置重试：无法支持固定/线性/自定义序列与上限截断。
- 纯指数时交给内置、其余自己做：两条代码路径，时间轴与实际行为可能不一致。
