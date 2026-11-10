window.__ModuleLoader__.load({ id: "dsh-model-failure-retry", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/entry.js
var ENTRY_ID = "model-failure-retry";

// src/client/locales.js
var en = {
  title: "Model failure retry",
  description: "Retry or switch models when a model request fails.",
  enabled: "Enable",
  enabledHint: "When off, failures are handled by DSH exactly as before.",
  rateLimit: "Retry on rate limit",
  rateLimitHint: "Short-window request or token limits (HTTP 429). Waits 5s, doubling, up to 60s, at most 5 retries.",
  transient: "Retry on transient failure",
  transientHint: "Upstream overload, 5xx, timeouts, dropped connections.",
  loading: "Loading\u2026",
  unavailable: "This plugin is not loaded, so it cannot be configured right now.",
  readOnly: "This deployment stores settings read-only.",
  saveFailed: "The change was not accepted."
};
var zh = {
  title: "\u6A21\u578B\u5931\u8D25\u91CD\u8BD5",
  description: "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\u65F6\u81EA\u52A8\u91CD\u8BD5\u6216\u5207\u6362\u6A21\u578B\u3002",
  enabled: "\u542F\u7528",
  enabledHint: "\u5173\u95ED\u540E\uFF0C\u5931\u8D25\u5B8C\u5168\u4EA4\u7ED9 DSH \u6309\u539F\u6709\u65B9\u5F0F\u5904\u7406\u3002",
  rateLimit: "\u9650\u6D41\u91CD\u8BD5",
  rateLimitHint: "\u77ED\u65F6\u95F4\u7A97\u53E3\u5185\u8BF7\u6C42\u6570\u6216 token \u6570\u8D85\u989D\uFF08HTTP 429\uFF09\u3002\u7B49\u5F85 5 \u79D2\u8D77\u3001\u6BCF\u6B21\u7FFB\u500D\u3001\u6700\u957F 60 \u79D2\uFF0C\u6700\u591A 5 \u6B21\u3002",
  transient: "\u4E34\u65F6\u6545\u969C\u91CD\u8BD5",
  transientHint: "\u4E0A\u6E38\u8FC7\u8F7D\u30015xx\u3001\u8D85\u65F6\u3001\u8FDE\u63A5\u4E2D\u65AD\u3002",
  loading: "\u52A0\u8F7D\u4E2D\u2026",
  unavailable: "\u8BE5\u63D2\u4EF6\u5F53\u524D\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E\u3002",
  readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  saveFailed: "\u4FEE\u6539\u672A\u88AB\u63A5\u53D7\u3002"
};

// src/client/section-controller.js
var CATEGORY_KEYS = ["rate-limit", "transient"];
function createSectionController(form) {
  let source;
  let view;
  function derive() {
    const snap = form.getSnapshot();
    if (snap === source) return view;
    source = snap;
    const value = snap.value ?? {};
    view = Object.freeze({
      status: snap.status,
      writable: snap.status === "ready" && snap.writable,
      enabled: value.enabled ?? true,
      categories: Object.freeze(Object.fromEntries(
        CATEGORY_KEYS.map((key) => [key, value.categories?.[key]?.enabled ?? true])
      ))
    });
    return view;
  }
  const set = (path, value) => form.mutate([{ op: "set", path, value }], form.getSnapshot().revision);
  return {
    getSnapshot: derive,
    subscribe: (listener) => form.subscribe(() => {
      const before = view;
      if (derive() !== before) listener();
    }),
    setEnabled: (on) => set(["enabled"], on),
    setCategory: (key, on) => set(["categories", key, "enabled"], on)
  };
}

// src/client/Section.jsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var row = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "12px 0" };
var hint = { opacity: 0.65, fontSize: 12, marginTop: 4 };
function ToggleRow({ id, label, hintText, checked, disabled, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { id, children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: hint, children: hintText })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Switch, { checked, disabled, label, onChange })
  ] });
}
function Section({ t, controller }) {
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const write = (promise) => {
    setFailed(false);
    promise.then((ok) => setFailed(!ok), () => setFailed(true));
  };
  if (state.status === "unavailable") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("unavailable") });
  const disabled = !state.writable;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hint, children: t("description") }),
    state.status === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hint, children: t("loading") }),
    state.status === "ready" && !state.writable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hint, children: t("readOnly") }),
    failed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: hint, children: t("saveFailed") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ToggleRow,
      {
        id: "mfr-enabled",
        label: t("enabled"),
        hintText: t("enabledHint"),
        checked: state.enabled,
        disabled,
        onChange: (on) => write(controller.setEnabled(on))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ToggleRow,
      {
        id: "mfr-rate-limit",
        label: t("rateLimit"),
        hintText: t("rateLimitHint"),
        checked: state.categories["rate-limit"],
        disabled: disabled || !state.enabled,
        onChange: (on) => write(controller.setCategory("rate-limit", on))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ToggleRow,
      {
        id: "mfr-transient",
        label: t("transient"),
        hintText: t("transientHint"),
        checked: state.categories.transient,
        disabled: disabled || !state.enabled,
        onChange: (on) => write(controller.setCategory("transient", on))
      }
    )
  ] });
}

// src/client/index.jsx
var NS = "dsh-model-failure-retry";
var inject = ["slots", "locale", "configForms"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "model-failure-retry: dictionaries");
  const t = ctx.locale.bind(NS);
  const controller = createSectionController(ctx.configForms.get(ENTRY_ID));
  ctx.effect(
    () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: ENTRY_ID,
      order: 60,
      label: () => t("title"),
      locale: NS,
      inject: () => ({ controller })
    }, Section))),
    "model-failure-retry: settings section"
  );
}

return module.exports;
} });
