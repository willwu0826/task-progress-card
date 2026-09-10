# 任务进度卡 · Task Progress Card

A visual progress-tracking skill for complex, long-running Codex tasks. Tracks mainline progress, detours, and return points; preserves step evidence and completion history; supports date-based search, source tracing, and resuming interrupted work. Stores data locally and displays tasks by conversation.

面向 Codex 长期与复杂任务的可视化进度管理 Skill。分别记录主线进度、临时回补和返回位置，保留步骤依据与完成历史，支持按时间检索、资料追溯和中断后的续接。任务数据本地保存，按对话关联展示，让复杂任务进展可见、过程可查、接续有据。

例如，任务正在第三步，却要回第一步补材料：卡片会同时显示“主线仍在第三步”和“当前正在补什么”；补齐后返回第三步，不把补材料误当重新开始。

## 当前功能

- 一项长期任务一张原卡，带版本和历史，不复制第二份当前状态。
- 主线、多层回补、返回点、验收依据与完结保护。
- 本对话范围的当前任务和历史，可按关键词、状态、月份或日期查找。
- 已完成步骤可点击查看依据，项目档案可追溯登记原文。
- Markdown 阅读版、只读旧卡、刷新与进程重启后的文件恢复。

**本版没有输入框或顶部固定按钮，没有全对话后台自动更新，也不会安装钩子。** 原生按钮仅保留为后续候选。

## 使用

依赖：现有 Node.js 22+。无 npm 依赖安装，无模型 API、云端账户或遥测。

仓库本身就是一个完整 Skill 目录。放入 Codex 支持的技能目录并保持目录名 `task-progress-card`，然后通过 `$task-progress-card` 调用。已有技能目录里有同名版本时先比较，不覆盖本地修改。技能发现/刷新方式按当前客户端提供的功能操作。

首次使用时让 Codex 选定已授权数据目录，关联该任务原卡。运行数据与安装目录分开保存，GitHub 只存程序。具体接口见 [SKILL.md](SKILL.md) 和按需引用的操作说明。

示例请求：

> 使用 $task-progress-card，恢复这个长期任务的进度。主线仍在第三步，这次只是回第一步补一份资料，补完回第三步。

查看页面需要本机服务运行。Codex 原生右侧工具可用时由执行者打开；也可使用本机浏览器。关闭网页不会删除任务进度。

## 开发验证

```sh
node --test tests/*.test.mjs
```

测试使用仓库内的独立示例，不读取维护者真实卡片。运行产物位于 tests/.runs 并被 Git 忽略。没有 GitHub Actions 自动化或 npm 发布动作。

Windows 是当前实际验证环境；打开项目文件夹功能仅适用于 Windows。其他系统的文件引擎和网页使用标准 Node API，但本版尚未逐平台实测。

参见 [发布范围](references/scope.md)、[数据操作](references/operations.md)、[显示与恢复](references/display.md)。

## 许可

本项目采用 [MIT License](LICENSE)。第三方 marked 保留其自身的 [MIT 许可与版权声明](assets/web/vendor/marked.LICENSE.md)。
