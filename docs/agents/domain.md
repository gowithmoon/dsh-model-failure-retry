# 领域文档

工程技能在探查代码库时应当如何使用这个仓库的领域文档。

**本仓库的域文档布局：single-context。** 整个仓库共用根目录一份 `GLOSSARY.md`，架构决定放在 `docs/adr/`；没有 `GLOSSARY-MAP.md`，也没有各子项目自己的 `GLOSSARY.md`。本次初始化不创建 `GLOSSARY-MAP.md` 与各子项目的 `GLOSSARY.md`，留到第一次真正写下词条时再建。

## 探查之前，先读这些

- 仓库根目录的 **`GLOSSARY.md`**。
- **`docs/adr/`**：读与你要动的那块区域相关的 ADR。

如果这些文件里有缺失的，就**直接继续，不必声张**。不要指出它们缺失，也不要建议预先创建。`/domain-modeling` 技能（经由 `/grill-with-docs` 和 `/improve-codebase-architecture` 到达）会在术语或决定真正确定下来时按需创建它们。

## 文件结构

single-context 仓库：

```
/
├── GLOSSARY.md
└── docs/adr/
    ├── 0001-event-sourced-orders.md
    └── 0002-postgres-for-write-model.md
```

## 使用词汇表里的词

当你的产出需要命名一个领域概念时（在议题标题、重构提案、假设、测试名称里），使用 `GLOSSARY.md` 里定义的那个词。不要改用词汇表明确回避的同义词。

如果你需要的概念还不在词汇表里，那是一个信号：要么你在造一套这个项目不用的说法（重新考虑），要么这里确实有空白（记下来，交给 `/domain-modeling`）。

## 标出与 ADR 的冲突

如果你的产出与已有的 ADR 矛盾，明确说出来，而不是悄悄覆盖：

> _与 ADR-0007（事件溯源的订单）矛盾，但值得重新讨论，因为……_
