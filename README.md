**English** | [中文](README.zh-CN.md)

# Task Progress Card

**Know where you left off. Continue from there.**

Task Progress Card is a visual progress-management skill for Codex. It brings the current task, mainline steps, temporary detours, and history into one card, helping you follow progress, recover context, and continue unfinished work in long conversations.

## Overview

During a long task, it is easy to lose track of the original goal, the current step, and what comes next. This is especially common when you reach step 3, return to step 1 for more material, and become absorbed in that temporary work.

Task Progress Card records the main task's position separately from what you are doing right now. When you revisit earlier work, it keeps a return point. When you come back days later, you can consult the card to recover recorded progress and remaining work.

It suits research, writing, development, and content-production tasks that take several rounds, as well as projects that span weeks and involve frequent pauses and resumptions.

## What You Get

| Feature | What it helps you do |
| --- | --- |
| Mainline progress | See the task goal, current step, current action, and next step. |
| Detours and return points | Record why you are revisiting earlier work, what needs to be added, and where to continue afterward, including nested detours. |
| Views by conversation | View the tasks linked to each conversation separately as you move between projects. |
| Searchable history | Find past tasks and progress by keyword, completion status, month, or date range. |
| Step and source tracing | Expand completed steps to review evidence, open linked records, and find the project location. |
| Local storage and recovery | Keep the original task card and history available after closing the page or restarting the service. |

## Quick Start

### 1. Install Task Progress Card

Send this request in Codex:

> Use $skill-installer to install the skill from https://github.com/willwu0826/task-progress-card. The skill is at the repository root, and its installation name is task-progress-card.

After installation, confirm that you can invoke `$task-progress-card`. See [Installation and Compatibility](#installation-and-compatibility) for environment requirements.

### 2. Set up a card for this conversation

Open the conversation you want to track and ask:

> Use $task-progress-card to set up a progress card for this conversation. Continue the existing record if there is one; otherwise create a card from this task's goals and steps.

On first use, have Codex identify the task to track and where its data will be saved. Existing cards continue in their original files, retaining their history.

### 3. Open the page

Ask:

> Use $task-progress-card to open this conversation's progress-card web page, starting or reusing its local page service.

The page can appear in a browser sidebar provided by Codex or in a browser on the same computer. Once open, it gives you access to the current task, recorded progress, and history.

## Everyday Use

In the relevant conversation, tell Codex what you want to do with the card:

| What you want to do | What you can say |
| --- | --- |
| View current progress | “Use $task-progress-card to open this conversation's progress-card web page.” |
| Update progress | “Update the card with the work we just completed and the next step.” |
| Revisit earlier work | “Keep the mainline at step 3. We are returning to step 1 for more material; record the detour and return point.” |
| Return to the mainline | “The material is ready. Record the result, finish the detour, and return to step 3.” |
| Resume later | “Use the card to tell me where we left off, what remains unfinished, and what comes next.” |
| Find past records | “Find the tasks completed last month in this conversation and their related materials.” |
| Finish a task | “Check whether this task meets its requirements, then record the result and mark it complete if it does.” |

In the web page, **Current Task (当前任务)** shows ongoing work, and **Conversation History (本对话记录)** lets you browse past records. Expand completed steps to review their evidence, or open a task's archive to view linked materials.

## How It Works

The card keeps three things separate: **the mainline position, the current detour, and the return point**.

For example, a research report is at step 3, but a source from step 1 needs checking:

```text
Mainline:      Step 3 — Write the report
Current detour: Return to step 1 to verify a source
Return when:  The source has been checked and recorded
Resume at:    Step 3 — Continue writing
```

As work progresses, Codex records actual changes in a local card file. The web page reads that file and displays the task for the corresponding conversation, periodically checking for updates while visible.

The page therefore shows saved progress. Closing it does not delete the card; reopening it reads the same original file.

## Installation and Compatibility

- **Codex environment:** Local skill support, access to task files, and the ability to run local programs.
- **Runtime:** Node.js 22 or later, with no additional npm dependency installation.
- **Installation scope:** Install for a project or as a user-level skill available across projects.
- **Platform:** Windows is the currently validated environment. Opening a project folder from the page is Windows-only; the complete workflow has not been validated on other systems.
- **Display:** A local web page. Availability of a Codex sidebar depends on the client's tools.
- **Language and dates:** The web interface and detailed reference documents are currently primarily in Chinese. Date filters use the `Asia/Shanghai` time zone.

For manual installation, place the complete `task-progress-card` folder in a supported skill location. See the [official Codex skill documentation](https://learn.chatgpt.com/docs/build-skills) for directory options.

Keep task data separate from the installation folder. Detailed configuration is covered in [Data and Operations](https://github.com/willwu0826/task-progress-card/blob/main/references/operations.md) and [Display and Recovery](https://github.com/willwu0826/task-progress-card/blob/main/references/display.md).

## FAQ and Troubleshooting

**Why is the page empty?**

The conversation may not have a linked card yet, or the page address may belong to a different conversation. Ask Codex to check this conversation's card association and open the correct page.

**Why can't I reach the page?**

The page depends on a local service. Ask Codex to check that the corresponding service is running and that the page address and port match.

**Why did Codex open a text file?**

The underlying card can be a Markdown file. To see the visual interface, explicitly ask: “Use $task-progress-card to open this conversation's progress-card web page.”

**Does progress update automatically?**

The web page reads the latest saved card contents. Codex needs to record task progress as work proceeds. Installing the skill does not start background monitoring of every conversation or install maintenance hooks.

**How do I reopen a closed card?**

Ask Codex to open this conversation's progress-card web page again, or use its existing page link while the service is running. There is currently no permanent button beside the chat input.

**Can I use it in other conversations?**

Yes. There is no two-conversation limit. Ask Codex to associate each conversation you want to track with its task. A project-scoped installation is available within that project.

**Can it recover everything from earlier chats?**

It recovers what has been saved in cards and linked materials. Progress that was never recorded is not filled in automatically.

## Privacy and Data

- **Stored information:** Task titles, goals, steps, progress, history, and linked file paths are kept in local files. Records and paths may contain personal or business information.
- **Data processing:** The card itself provides no cloud sync, collects no telemetry, and makes no model API calls. When Codex reads cards or materials, their contents can enter its model context and are subject to Codex account settings and data-handling rules.
- **Page access:** The page service is available on the local machine by default. It has no separate account login system, and programs with suitable access on the same computer may read its contents. It is not intended to be exposed publicly.
- **Sharing:** Before sharing screenshots, logs, or task files, check for names, project details, and private paths. File-exclusion settings in the code repository do not automatically remove personal information.
- **Backup and removal:** Back up cards, conversation associations, and any original materials you need to retain. Uninstalling the skill does not automatically delete separately stored task data.

## Development and License

Executor instructions are in [SKILL.md](https://github.com/willwu0826/task-progress-card/blob/main/SKILL.md). After changing the code, run the tests from the repository root:

```sh
node --test tests/*.test.mjs
```

This project uses the [MIT License](https://github.com/willwu0826/task-progress-card/blob/main/LICENSE). The Markdown renderer, marked, retains its own [MIT license and copyright notice](https://github.com/willwu0826/task-progress-card/blob/main/assets/web/vendor/marked.LICENSE.md).
