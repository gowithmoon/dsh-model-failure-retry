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
  match.js               matchesModel(pattern, ref)：provider/model 通配（#4，#6 的链匹配也用它）
  chain.js               切换链（#6）：matchChain(model, chains) → {index, chain}、candidateOrder(candidates, current)（循环顺序）、sameModel(a, b)
  policy.js              DEFAULT_POLICY、resolvePolicy(target, config)：overrides 第一条命中，否则全局策略
  schedule.js            fixed/linear/exponential/custom；retrySchedule(policy)（展示用）、nextDelay(policy, attempt, {retryAfterMs, random})（运行时用）
  config.js              CoreConfig 形状 + defaultConfig()
  decide.js              decide(failure, requestState, config, {random, isAvailable}) → Decision（pass / retry / fallback / skip / give-up）
src/host/                DSH 适配层
  index.js               apply：prepend 监听 agent/request-error，并调用 settings.configure({auto:false})
  schema.js              Schemastery Config（字段都是 volatile）+ snapshotConfig(config) → CoreConfig
  request-state.js       按 agent 存一条记录，key = turn:step:provider/model
  fallback-state.js      按 agent 存切换状态（#6）：origin、tried、selected、pending
  wait.js                wait(ms, signal)：signal 取消时立即结束，且不留下定时器
src/client/              Web 客户端（esbuild 打包，react / jsx-runtime / ui-primitives 用宿主提供的）
  index.jsx              apply：注册 locale，在 whileServed([ENTRY_ID]) 期间注册 settings.section
  section-controller.js  把 ConfigForm 投影成视图状态，写入走 form.mutate([{op:'set', path, value}])
  Section.jsx            总开关 + 限流 / 临时故障开关；下挂各票子小节
  policy-controller.js   重试策略（#4）：写 ['policy', 字段]，覆盖整表写 ['overrides']；parseSequence/formatSequence
  timeline.js            timeline(policy)：在 retrySchedule 上累计出 T0 起的各次重试时刻与抖动区间
  PolicySection.jsx      重试策略 → 时间轴 → 按模型覆盖（每条可展开自己的时间轴）
  rules-controller.js    分类规则（#5）：整表写 ['rules']，test() 给测试框
  RulesSection.jsx       分类规则列表 + 测试框
  chains-controller.js   切换链（#6）：整表写 ['chains']；createModelCatalog() 装 remote.session.modelCatalog() 给下拉框
  ChainsSection.jsx      切换链列表：匹配规则 + provider → model 两级下拉候选，缺失项黄色警告
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
5. 要离开当前模型时（`fallback` / `skip` / `give-up chain-exhausted`），先用 `llm.resolveModelInfo` 查链上各候选是否还存在（没有 `llm` 服务时视为都存在），再带 `isAvailable` 重新 `decide` 一次，然后：
   - `skip`：记入 tried，发一条决定事件，接着看 `then`；
   - `fallback`：`agent.model.select(候选)`（推理强度候选支持就沿用，否则不带、用候选默认值），记 `pending`，返回 `undefined` 结束本轮；
   - `give-up`（链走完）：清掉切换状态，如果当前不是原模型就 `select(原模型)`，不续轮。
6. `agent/status` 变为 `idle` 时，若有 `pending` 且本轮 signal 没被取消（用户停止），调用 `agent.followup(...)`：文本 `"Continue."`（`FOLLOWUP_TEXT`），`source: {kind:'model-fallback', form:'notice', summary}`。DSH 自己会在下一步前插入 `[model changed: ...]`。

只有 `pass` 会调用 `next()`，所以插件接管的类别不会再被内置 llm-retry 重试一遍（ADR 0001）。另外，上下文超限（见 #5）、IMAGE_OFFLOAD_REQUIRED、EMPTY_RESPONSE 这些错误码不属于任何类别，会落到 `pass`，压缩插件和内置重试照常处理它们。

## 给后续票的扩展点

规则是新增文件、新增配置的兄弟键，不改已有键的形状。

- #4 策略、覆盖、时间轴（已实现）：`config.overrides = [{match, policy}]`，按顺序取第一条命中；覆盖里没写的字段取 DEFAULT_POLICY，不继承全局策略（新增覆盖时界面把全局策略复制进去）。custom 用 `policy.sequenceMs`，比最大次数短时重复最后一个值，空序列退回首次延迟。匹配规则不含 `/` 时视为 `*/<pattern>`。
- #5 分类规则（已实现）：规则 `{status, code, pattern, regex, category}`，`status` 0 / 空串表示任意；`category` 可以是四个类别之一或 `context-window`。按顺序取第一条命中，都不命中才按错误码。配置 `rules` 是一个 volatile 数组，默认值就是 `DEFAULT_RULES`，用户列表整体替换默认（"恢复默认"写回 `defaultRules()`）。非法正则运行时永不命中。无 `failure.status` 时（pi-ai）从错误信息里取第一个三位状态码，裸 RATE_LIMIT 视为 429。
  - 上下文超限：`classify` 返回 `{category:'fatal', reason:'context-window'}`（CONTEXT_WINDOW_EXCEEDED 码或 `context-window` 规则）。`decide` 对当前模型返回 `pass`，好让后面的压缩插件处理；#6 在候选模型上见到这个 reason 应返回 `skip`。
- #6 切换链（已实现）：配置 `chains = [{match, candidates: [{provider, model}]}]`，一个 volatile 数组，默认 `[]`。
  - 链按**这一轮切换的起点**（`episode.start`，即原模型；还没切换过时就是当前模型）匹配，第一条命中的链生效；候选顺序也以起点为准（循环），再去掉 tried 和当前模型。所以从 a 切到 b 后 b 再失败，走的仍是 a 的链。
  - 离开当前模型的原因（`fallback.reason` / `skip.reason`）：`quota`、`retries-exhausted`、`fatal`、`context-window`、`missing-model`。在原模型上 fatal 直接 give-up、上下文超限照旧 `pass`（给压缩插件）；在候选模型上两者都是 `skip` 到下一个。链走完是 `give-up` `chain-exhausted`；没有链命中时 give-up 的 reason 就是离开原因（`quota` / `retries-exhausted`），行为同 #6 之前。
  - 候选模型按它自己的重试策略（`resolvePolicy(当前模型)`），计数随 turn 变化自然清零（续轮是新的 turn）。
  - 状态（`src/host/fallback-state.js`，按 agent 的 WeakMap，子代理各自一份）：`origin` 原模型（含推理强度）；`tried` 本次链行走已试的模型；`selected` 插件最后一次 select 的模型；`pending` 待续轮。某一轮没发生切换就结束（idle 且无 pending）时 `tried` 清空、`origin` 保留，下次失败从头按原模型的链走。链走完后整个状态清空（`origin` 也清）。
  - 用户手动换模型：下次失败时发现当前模型 ≠ `selected`，状态清空，于是用户选的模型成为新的原模型（发一条 `origin-reset` 决定事件）。注意这是**惰性**的，在下一次失败时才更新，不是换模型的那一刻。
- 决定事件（给 #7 / #8 / #9）：每次处理 request-error 都 `ctx.emit('model-failure-retry/decision', payload)`（常量 `DECISION_EVENT`，从 `src/host/index.js` 导出），同步、监听者抛错不影响恢复。payload：
  `{ agent, model, failure, decision, origin, tried }`。`model` 是这次失败的模型 `{provider, model}`；`decision` 是 core 的 Decision，其中 `fallback` 多带 `selection`（实际 select 的值，含推理强度），`skip` 每个跳过的候选一条（不带 `then`），另有适配层自己的 `{kind:'origin-reset'}` 与回切的 `{kind:'switch-back', from, to}`（这两种可能不带 `failure`，见 #9）；`origin` / `tried` 是发事件时的切换状态（`give-up chain-exhausted` 时还没清空，所以能看到原模型）。`retry` 事件在等待**之前**发出，带 `delayMs` / `attempt` / `maxAttempts`。监听写法：`ctx.on('model-failure-retry/decision', (e) => ...)`，需在同一 Cordis 作用域（同一插件内的子模块最简单）。
- #7 状态投影：订阅决定事件即可拿到等待、切换、跳过、放弃；"等待结束"没有单独事件（retry 返回后即开始重试）。用 session projection，不新增 session 事件类型。停止：本轮 signal 取消时等待立即结束，且不续轮。
- #8 统计（已实现）：`src/host/stats.js` 订阅决定事件，记录转换在 `src/core/stats.js`（`recordOf` / `queryStats` / `isExpired`）。记 retry、fallback、skip、switch-back、give-up（记作 failure）；pass、origin-reset 不记。另看 session/event 的 `turn/end`：有过重试或切换的会话，下一次 `completed` 记 rescued（切换那一轮以 error 收尾不算），`aborted` 且 `reason.kind === 'user'` 记 stop。存 storageDomain `model_failure_retry_stats`（per-record，表 `events`），保留期 `stats.retentionDays`（默认 30 天），打开时和每小时清理一次。别的插件或模块要进统计：emit 同一个决定事件即可，payload 至少 `{ agent, decision: { kind, ... } }`，没有 `failure` 也行；新 kind 要先加进 `RECORD_KINDS` 和 `recordOf`。
- 统计 Remote：服务 `modelFailureRetryStats.query(query)`，描述符在 `src/stats-remote.js`（Host 用它注册 typert manifest，client 用它 `$mount`）。
- #7 状态行与停止（已实现）：不加新会话事件类型。等待重试前，适配层往会话日志写 DSH 已有的 `llm/retry`（`policyKey` 为 `model-failure-retry:<分类>`，同一请求的多次重试共用一个 `retryId`，存在 request-state 上），等满后写 `llm/retry-started`；所以 DSH 聊天自带的重试行也会显示。`src/host/status-projection.js` 注册会话投影 `modelFailureRetry`（键常量在 `src/status-projection-key.js`，Host/Client 共用），视图为 `null` / `{kind:'retry', category, attempt, maxAttempts, retryAt}` / `{kind:'switch', from, to}`；`llm/retry-started`（同 retryId）与 `step/start` 清掉重试，`turn/end` 清掉一切；切换来自续跑消息 `user/message` 的 `source`（`kind:'model-fallback'`，现在多带 `from` / `to`）。重开会话时投影可能停在最后一次等待，Client 只在会话 running 且未过重试时间 5 秒时显示（`src/client/status-line.js`）。Client 在 `conversation.input.dock` 挂 `StatusDock`（需可选服务 `sessions`），停止按钮调该会话 `conversation.cancel()`，与 DSH 自带停止等效。Host 侧：等待中 turn signal 中止、中止后再来的失败、或切换后到 idle 前已中止，都走 `stopped()`：发决定事件 `{kind:'stopped'}`（可能不带 `failure`）、清空切换状态、选回原模型、不续跑。#8 统计不记 `stopped`（`recordOf` 返回 undefined），stop 仍由 `turn/end aborted(user)` 记。
- #9 回切（已实现）：`src/host/switch-back.js` 的 `installSwitchBack(ctx, {fallbacks, publish, settings, decisionEvent, active})`，判断在 `src/core/switch-back.js` 的 `switchBackDue`。配置 `switchBack: {enabled (默认 false), intervalMs (默认 600000)}`。
  - 挂点是**每轮第一条** `agent/inbox/claimed`，不是 `agent/pre-step`：dsh-agent-loop 先认领收件箱、再读 `agent.model.current()` 定本步模型，所以在这里 `select()` 本步就生效；`agent/pre-step` 拿到的 `modelSelection` 已经定了，select 只影响下一步（工具循环）。同一轮后续的认领（第 2 步起）忽略，所以工具循环中途不回切。切换后的续跑轮（`source.kind === 'model-fallback'`）也不算新一轮。
  - 计时：从决定事件里记 `model` 等于 `origin` 那条的时间（原模型上次失败）；`origin-reset` 清掉计时。不发探测请求。
  - 回切时先发决定事件 `{kind:'switch-back', from, to}`（`from` 是当前候选模型 `{provider, model}`，`to` 是原模型、含推理强度；**不带 `failure`**；`origin`/`tried` 是回切前的状态），再 `fallbacks.clear(agent)` 并 `select(origin)`。原模型再失败就照常从头走切换链。
  - 新一轮开始时也会检查手动换模型（当前 ≠ `selected`），发 `origin-reset`（**不带 `failure`**），所以手动换模型最晚在下一轮开始时生效（开了回切与否都检查）。
- 配置：在 `src/host/schema.js` 的 `Config` 里加兄弟键，并在 `snapshotConfig` 里读出来。volatile 只能放在固定的对象路径上，而且不能嵌套，所以列表（规则、链、覆盖）整个作为一个 volatile 数组字段。
- 设置页：每张票写自己的 controller 和组件，挂在 `Section.jsx` 里，顺序是 重试策略 → 时间轴 → 切换链 → 分类规则 → 回切 → 统计。写配置只写自己负责的路径。

## 已知事实

- 重试计数的 key 是 `turn:step:provider/model`。DSH 重试时会重跑同一个 step；换了 step 或换了模型，计数从 0 开始。子代理是另一个 agent，有自己的计数。
- `dsh-llm-pi-ai`（0.2.2-rc.1）不会把 Retry-After 响应头放进 `failure.providerRetryAfterMs`，所以 OpenAI 兼容的提供方实际上拿不到 Retry-After。`dsh-llm-deepseek` 会填这个字段。
- 会话标题生成之类的旁路请求不经过 `agent/request-error`，不归本插件处理。
- 切换走 ADR 0002：失败的那一轮以 LlmError 结束（GUI 里可见一条错误），续轮由 `agent/status` idle 触发。headless 冒烟 `run.sh daily`：daily 429 → 跳过不存在的 mock/ghost → select mock/ok → 第 2 轮 "Continue." 成功，共 3 个请求（含标题请求）。
- 下拉框的模型目录来自 `remote.session.modelCatalog()`（DSH 自己的模型菜单也用它，Host 侧由 llm.listProviders / listModels 组成）；客户端插件通过可选的 `ctx.inject(['remote', 'remote.session'])` 拿，拿不到时下拉框为空、不报缺失警告。
- patch 条目的 `name` 必须是字面字符串。写成 `!!js` 表达式时，DSH 会以 `name.startsWith is not a function` 禁用这一行。
