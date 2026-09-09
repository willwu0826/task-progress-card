# 数据与操作接口

## 数据位置

在已授权位置选择一个持久数据目录，将其绝对地址设为 `PROGRESS_CARD_HOME`。多个使用同一套卡片的执行者复用同一数据目录。它保存 registry.json；项目状态仍在各自原始文件。数据目录不要提交 Git。

示例（路径只是示例，实际采用用户已授权位置）：

```powershell
$env:PROGRESS_CARD_HOME = 'D:\TaskCardData'
node '<skill-dir>\scripts\setup.mjs'
```

setup 只创建空登记，已有文件保持原样。所有命令中的 `<skill-dir>` 应替换为本 Skill 实际目录。已有 Node 不在 PATH 时使用它的完整路径，不自动安装运行时。

## 结构化卡

`node scripts/cli.mjs read <原卡绝对路径>` 读取当前 revision。

`node scripts/cli.mjs init <新卡绝对路径> <初始化JSON路径>` 只在原卡不存在且已获授权时使用，不覆盖已有文件。

初始化输入示例：

```json
{
  "id": "example-delivery",
  "threadId": "从本次运行时取得的真实ID",
  "title": "交付一个示例成果",
  "goal": "完成可验收的成果",
  "steps": [
    {"id":"prepare","title":"准备材料","done":false},
    {"id":"build","title":"制作成果","done":false},
    {"id":"verify","title":"验收交付","done":false}
  ],
  "acceptance": ["真实成果与用户要求一致"]
}
```

输入 JSON 放在该次任务的授权目录；它是操作输入，不是第二张状态卡。主卡包含步骤、主线指针、回补栈、当前动作、下一步、状态、revision 和带时区的 history。

更新：`node scripts/cli.mjs update <原卡绝对路径> <刚读到的revision> <动作JSON路径>`。

| type | 主要字段 | 用途 |
|---|---|---|
| setAction | text, nextAction（可选） | 保存真实当前动作 |
| startDetour | id, title, reason, doneWhen | 保存临时回补及自动返回点 |
| reviseDetour | id, title, reason, doneWhen, correction | 纠正最上层回补，保留旧目标 |
| finishDetour | evidence | 回补验收后恢复原位置 |
| advance | evidence | 验收当前主线步骤后前进 |
| invalidate | stepId, reason | 撤销被新证据推翻的当前及后续验收 |
| setStatus | status | READY / RUNNING / REVIEW / BLOCKED |
| complete | evidence | 全部验收且无回补后完结 |

例如主线第三步发现第一步缺材料，执行 startDetour，不把主线改回第一步。没有回补验收证据就保持未完结。

引擎使用独占锁、版本检查和原子替换。CARD_CONFLICT 表示有人写入了新进展；CARD_LOCKED 表示存在写入者。先核实，不猜测旧锁、不盲目重试，不整卡恢复旧快照。

## 绑定与资料导航

`node scripts/bind.mjs <绑定JSON路径>` 使用真实运行时 CODEX_THREAD_ID。示例输入：

```json
{
  "kind":"card",
  "id":"example-delivery",
  "title":"交付一个示例成果",
  "source":"D:/ExampleProject/progress.md",
  "projectRoot":"D:/ExampleProject",
  "records":[{"id":"brief","title":"项目要求","path":"D:/ExampleProject/brief.md","stepIds":["prepare"]}]
}
```

source、projectRoot、records.path 均须按实际证据和授权填写绝对路径。原卡 id/threadId 必须匹配，既有未完结任务指针不能被新卡替代。同一绑定再次运行不清掉已登记资料，也不重复写入。传 records 时会替换该条目的资料列表，应保留已有有效条目。

旧格式卡用 `kind: legacy`，只做只读投影，不迁移原文。状态从表格“当前状态/状态”读取，缺失明确为 UNKNOWN。后续维护在原文件进行；不能用结构化 cli 强行重写 legacy。

更新导航需要明确来源，历史记录保留。不要通过修改 threadId 绕过对话限制；源码库不提供用户原始登记表。
