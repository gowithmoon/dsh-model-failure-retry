# 架构说明

一个 npm 包里放三样东西：Host 插件、Web 客户端插件，以及挂载 Host 插件的 bundle patch。术语见 `GLOSSARY.md`，关键决定见 `docs/adr/`。

## 目录

```
index.js                 Host 入口（Loader 按 "<package>/index.js" 解析），转发 src/host
cordis.patch.yml         bundle patch：插入 id 为 model-failure-retry 的条目
client.js                构建产物（npm run build，已 gitignore），由 src/client 打包
locale/{zh,en}.json      插件管理页用的 meta.title / description
src/entry.js             ENTRY_ID = 'model-failure-retry'；它既是 patch 条目 id，也是 settings 命名空间
src/core/                决策核心：纯逻辑，不依赖 DSH，一个文件管一件事
  types.js               JSDoc 类型：Category、ModelRef、RetryPolicy、RequestState、Decision
  categories.js          失败类别常量
  classify.js            classify(failure, rules) → { category, reason?, rule?, ruleIndex? }
  rules.js               分类规则：DEFAULT_RULES / defaultRules()、firstMatchingRule、ruleError、failureStatus
  policy.js              DEFAULT_POLICY、resolvePolicy(target, config)
  schedule.js            retrySchedule(policy)（展示用）、nextDelay(policy, attempt, {retryAfterMs, random})（运行时用）
  config.js              CoreConfig 形状 + defaultConfig()
  decide.js              decide(failure, requestState, config, {random}) → Decision
src/host/                DSH 适配层
  index.js               apply：prepend 监听 agent/request-error，并调用 settings.configure({auto:false})
  schema.js              Schemastery Config（字段都是 volatile）+ snapshotConfig(config) → CoreConfig
  request-state.js       按 agent 存一条记录，key = turn:step:provider/model
  wait.js                wait(ms, signal)：signal 取消时立即结束，且不留下定时器
src/client/              Web 客户端（esbuild 打包，react / jsx-runtime / ui-primitives 用宿主提供的）
  index.jsx              apply：注册 locale，在 whileServed([ENTRY_ID]) 期间注册 settings.section
  section-controller.js  把 ConfigForm 投影成视图状态，写入走 form.mutate([{op:'set', path, value}])
  Section.jsx            总开关 + 限流 / 临时故障开关；下挂各票子小节
  rules-controller.js    分类规则（#5）：整表写 ['rules']，test() 给测试框
  RulesSection.jsx       分类规则列表 + 测试框
  locales.js             zh / en 文案，两边的 key 必须一致（有测试检查）
test/core/               接缝 1：决策核心
test/host/               接缝 2：假宿主（test/support/fake-host.js，用的是真实的 Cordis Context）
test/client/             控制器、文案、打包后 client.js 的注册行为
test/fixtures/smoke/     实机冒烟：run.sh 起 mock LLM，再跑 headless dsh
```

## 数据流

`agent/request-error`（prepend）的处理顺序：

1. `snapshotConfig(config)` 读出最新配置。每次失败都现读，所以热更新不需要重挂载。
2. `requests.get(agent, {turn, step, model})` 拿到本次请求在当前模型上已经重试了几次。
3. `decide(...)` 返回一个 Decision。
4. 按 Decision 执行：`pass` 调用 `next()`；`retry` 先等待，再返回 `{kind:'retry'}`，不调用 `next()`；`give-up` 返回 `undefined`，本轮以 LlmError 结束，也不调用 `next()`。

只有 `pass` 会调用 `next()`，所以插件接管的类别不会再被内置 llm-retry 重试一遍（ADR 0001）。另外，上下文超限（见 #5）、IMAGE_OFFLOAD_REQUIRED、EMPTY_RESPONSE 这些错误码不属于任何类别，会落到 `pass`，压缩插件和内置重试照常处理它们。

## 给后续票的扩展点

规则是新增文件、新增配置的兄弟键，不改已有键的形状。

- #4 策略、覆盖、时间轴：`policy.js` 的 `resolvePolicy(target, config)` 已经接收目标模型，覆盖规则放在 `config.overrides`。新的延迟算法加在 `schedule.js` 的 `baseDelay` 里，按 `policy.kind` 分支。时间轴直接用 `retrySchedule(policy)`，它返回每次等待的 `delayMs/minMs/maxMs`。
- #5 分类规则（已实现）：规则 `{status, code, pattern, regex, category}`，`status` 0 / 空串表示任意；`category` 可以是四个类别之一或 `context-window`。按顺序取第一条命中，都不命中才按错误码。配置 `rules` 是一个 volatile 数组，默认值就是 `DEFAULT_RULES`，用户列表整体替换默认（"恢复默认"写回 `defaultRules()`）。非法正则运行时永不命中。无 `failure.status` 时（pi-ai）从错误信息里取第一个三位状态码，裸 RATE_LIMIT 视为 429。
  - 上下文超限：`classify` 返回 `{category:'fatal', reason:'context-window'}`（CONTEXT_WINDOW_EXCEEDED 码或 `context-window` 规则）。`decide` 对当前模型返回 `pass`，好让后面的压缩插件处理；#6 在候选模型上见到这个 reason 应返回 `skip`。
- #6 切换链：在 `decide.js` 里，`quota`/`fatal` 目前直接返回 `give-up`，以后改为查链，返回 `fallback`/`skip`。链逻辑放新文件 `src/core/chains.js`（`matchChain`、`candidateOrder`）。`request-state.js` 的每 agent 记录里再加原模型、所用链、已试候选。适配层的 `switch` 加一个 `fallback` 分支，按 ADR 0002 先 `select`、结束本轮，再 `followup`。
- #7 状态投影：在适配层 `retry` 分支的等待前后发出状态，用 session projection，不新增 session 事件类型。
- #8 统计：在适配层的每个分支记录一次结果，建议新建 `src/host/stats.js`，不要写进决策核心。
- #9 回切：新建 `src/host/switch-back.js`，监听 `agent/pre-step`；判断逻辑放 `src/core/switch-back.js`。
- 配置：在 `src/host/schema.js` 的 `Config` 里加兄弟键，并在 `snapshotConfig` 里读出来。volatile 只能放在固定的对象路径上，而且不能嵌套，所以列表（规则、链、覆盖）整个作为一个 volatile 数组字段。
- 设置页：每张票写自己的 controller 和组件，挂在 `Section.jsx` 里，顺序是 重试策略 → 时间轴 → 切换链 → 分类规则 → 回切 → 统计。写配置只写自己负责的路径。

## 已知事实

- 重试计数的 key 是 `turn:step:provider/model`。DSH 重试时会重跑同一个 step；换了 step 或换了模型，计数从 0 开始。子代理是另一个 agent，有自己的计数。
- `dsh-llm-pi-ai`（0.2.2-rc.1）不会把 Retry-After 响应头放进 `failure.providerRetryAfterMs`，所以 OpenAI 兼容的提供方实际上拿不到 Retry-After。`dsh-llm-deepseek` 会填这个字段。
- 会话标题生成之类的旁路请求不经过 `agent/request-error`，不归本插件处理。
- patch 条目的 `name` 必须是字面字符串。写成 `!!js` 表达式时，DSH 会以 `name.startsWith is not a function` 禁用这一行。
