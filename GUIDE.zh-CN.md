# Autopilot

把一句自然语言需求，变成一套可回答、可批准、可恢复的分阶段工作流。

[English](./README.md) | 中文说明

---

## Autopilot 是做什么的？

Autopilot 会把你的请求推进成这样一条链路：

```text
需求 -> 规格精炼 -> 计划 -> 开发 -> 评审 -> 测试 -> 完成
```

在这个过程中，它可能会：

- 向你提澄清问题
- 请求你批准计划
- 在 review/test 卡住时等你决定
- 让你继续当前任务、重跑当前阶段，或新开任务

目的很简单：少一点一把梭的猜测，多一点可见、可控的过程。

## 安装

在 OpenCode 的配置文件 `opencode.json` 中加入：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

然后重启 OpenCode。

## 快速开始

直接说需求：

```text
给商品列表页增加排序功能，并注意回归风险。
```

也可以明确带上需求文档：

```text
请基于这份文档启动 workflow。
/ap-doc: docs/requirement.md
/ap-mode: safe
```

## 可直接复制的 5 条示例

### 1）正常启动一个 workflow

```text
给商品列表页增加排序功能，并注意回归风险。
```

### 2）从需求文档启动

```text
请基于这份文档启动 workflow。
/ap-doc: docs/requirement.md
/ap-mode: safe
```

### 3）对一个很小且明确的改动直接走 develop

```text
修改结账页主按钮文案。
/ap-start-at: develop
```

### 4）review/test 阻塞后，回到 develop 修问题

```text
workflow_resume
payload: fix
```

### 5）你在 workflow 外手改了代码后，重跑 review/test

```text
workflow_status -> workflow_resync -> workflow_attach
```

## 你通常需要做什么？

### 1）回答澄清问题

如果规格精炼阶段不能安全推断某些信息，Autopilot 会问你。

常见问题包括：

- 验收标准
- 范围边界
- 这是继续当前任务，还是新开任务

### 2）批准计划

计划批准属于**人工确认点**。

正确行为应该是：

1. 先展示完整审批区块
2. 等你明确确认
3. 再执行 `workflow_approve`

### 3）看评审 / 测试结果

如果 review 或 test 发现问题，workflow 可能：

- 自动回到 develop
- 暂停并等你决策

## 聊天里可以直接写的 inline 指令

这些**不是** OpenCode slash command，而是 Autopilot 在普通消息正文里自己解析的指令。

### `/ap-doc:`

把某个文档路径标记为本次 workflow 的显式输入来源。

```text
/ap-doc: docs/requirement.md
```

适合在你不想让 Autopilot 自己猜是哪份文档时使用。

### `/ap-mode:`

设置 workflow 模式：

```text
/ap-mode: light
/ap-mode: standard
/ap-mode: safe
/ap-mode: debug
```

### `/ap-start-at: develop`

跳过规格精炼和计划，直接从 `develop` 开始。

```text
/ap-start-at: develop
```

只建议在需求已经非常清楚时使用。

## OpenCode 里能补全的公开命令

这些才是会出现在 OpenCode 命令补全里的：

- `/ap-light`
- `/ap-standard`
- `/ap-safe`
- `/ap-debug`
- `/ap-review-heavy`
- `/ap-develop`
- `/ap-verify`

## 工作流恢复

### 什么时候用 `workflow_resume`

当 workflow 被阻塞，而你希望它继续时，用 `workflow_resume`。

对于 review/test 阻塞场景，现在支持更直接的 payload：

- `fix`
- `accept`

一般含义：

- `fix`：回到 develop 修问题
- `accept`：接受当前状态并继续/结束（如果该阶段允许）

### 什么时候用 `workflow_resync`

当满足下面条件时，用 `workflow_resync`：

- workflow 停在 `review` 或 `test`
- 你在 workflow 外手动改了代码
- 你想让当前阶段基于最新 worktree 重跑

常见顺序：

```text
workflow_status -> workflow_resync -> workflow_attach
```

## 任务关系确认

有些时候，Autopilot 无法确定你的新消息到底是：

1. 继续当前任务
2. 创建新的独立任务
3. 从当前任务派生后续任务

这时它会先停下来问你，而不是直接猜。

现在这类确认会被持久化，因此后续的 `workflow_answer` 可以可靠继续，不会再因为确认状态丢失而一直卡在原地。

## FAQ / 常见问题

### Q：我输入 `/ap-doc`，为什么没有 OpenCode 的命令提示？

因为 `/ap-doc:` 不是 OpenCode 的 slash command，而是 Autopilot 的 inline 指令。

正确用法是直接写在消息正文里：

```text
请启动 workflow
/ap-doc: docs/requirement.md
```

### Q：`/ap-doc:` 到底有什么作用？

它的作用是告诉 Autopilot：

**这份文档就是本次 workflow 的明确输入来源。**

不是宿主命令，不会出现在 slash command 补全里。

### Q：Autopilot 问我是继续当前任务，还是创建新任务，我该怎么选？

- 还是同一轮交付，就选 **继续当前任务**
- 完全独立的新需求，就选 **创建新的独立任务**
- 同一主题的下一轮扩展，就选 **派生后续任务**

### Q：之前我回复编号后，workflow 还是卡住不继续，这是为什么？

之前确实出现过这类问题：

- 确认问题问出来了
- 但确认状态没有正确持久化
- 或者 `workflow_answer` 没识别你回的 `choice` / `intentChoice`

现在已经增强，支持例如：

- `{"choice": 1}`
- `{"choice": 2}`
- `{"intentChoice": 2, "intentText": "创建新的独立任务"}`

### Q：`workflow_resume` 和 `workflow_resync` 有什么区别？

- `workflow_resume`：继续一个被阻塞的决策点
- `workflow_resync`：在你手改代码后，让 review/test 重新基于当前代码重跑

### Q：`workflow_resume fix` 是什么意思？

表示：

**从 review/test 的阻塞状态回到 develop，去修问题。**

### Q：`workflow_resume accept` 是什么意思？

表示：

**接受当前阻塞状态，并在阶段逻辑允许时继续或结束。**

### Q：为什么它没有直接进入全新的 workflow？

因为你的消息看起来也可能是在继续已有 workflow。Autopilot 现在倾向于先问清楚，而不是直接猜错。

### Q：为什么计划批准没有自动执行？

因为计划批准本来就应该是人工确认点。

正确行为应该是：

1. 展示完整审批区块
2. 等你明确确认
3. 再执行 `workflow_approve`

### Q：后期 prompt 会不会因为 artifact 太长而失控？

现在 Autopilot 会优先按关键 markdown section 压缩注入到 prompt 的 artifact，只有在拿不到结构时才退回普通截断。

这是一套代码规则压缩，不是额外再调一次 AI 去总结。

### Q：如果 artifact 缺标题、标题乱序、内容为空、或者只有占位词怎么办？

现在这套压缩逻辑已经专门增强过：

- 跳过空 section
- 过滤只有占位词的 section
- 优先 section 不可用时，回退扫描更多标准 section
- 再不行才退回截断

## 如果你只是普通使用者

那你基本可以只记住这几件事：

1. 直接说需求
2. 有文档就用 `/ap-doc:`
3. 需要严谨一点就加 `/ap-mode: safe`
4. 看清楚它问的是“继续任务”还是“批准计划”
5. review/test 卡住后，根据情况选 `workflow_resume fix` 或 `workflow_resync`

其余配置文件和内部机制，默认都可以先不用管。
