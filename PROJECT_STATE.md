# Fairy 项目交接材料

> 交接编号：H1 ｜ 状态：**材料已核对，待接手核验** ｜ 更新时间：2026-09-27
> 工作目录（绝对路径）：`C:\Users\91533\Desktop\Fairy`

## 1. 任务与版本

- **目标**：Fairy = Windows 桌面私人助手，以 **DeepSeek 网页版**（chat.deepseek.com 会话）为 LLM 后端，零 API 成本。MVP 范围 F1–F7 见 `docs/DEV_PLAN.md` §1。
- **范围（MVP）**：聊天（流式）、多会话、"帮我记东西"、日程+托盘通知、FTS5 长期记忆、托盘/Alt+Space 浮窗/开机自启、登录引导流。明确不做：工具循环/Agent/Shell、Skill、MCP、云同步、多用户、cron 引擎。
- **完成标准**：里程碑 M0–M4（见 DEV_PLAN §9），当前处于 **M0 中段**。
- **git 位置**：仓库 2 个提交，工作树干净（`git status` 无未提交改动）：
  - `bf06919` 阶段 0：pnpm workspace + Electron 骨架 + 图标 + NSIS 打包通过
  - `b9932fe` docs：附录 C 本机环境备忘（HEAD）
- **文档版本**：`docs/DEV_PLAN.md` v0.2（需求收敛后的有效版本）。

## 2. 权威资料

| 资料 | 位置 | 管哪部分 |
|---|---|---|
| 开发计划（架构/阶段/验收/数据模型/风险） | `docs/DEV_PLAN.md`（v0.2） | 全部任务事实的总纲；验收标准以 §6 各阶段"验收"为准 |
| 本机环境备忘（Node 路径/镜像/打包命令/陷阱） | `docs/DEV_PLAN.md` 附录 C | 本机 Windows 开发环境与打包操作 |
| 蓝本（只读参考，nested gitlink，不参与构建） | `reference/deepseek-pp/` | 仅借鉴设计（记忆系统命名、schema 迁移规则）；自建网关（阶段 6 可选项）才需精读其 `core/deepseek/*` |
| 阶段 1 产出（已完成） | `docs/llm-bridge-notes.md`（已创建） | LLM 网关的 model 取值、会话过期报错指纹、限速特征 |

冲突规则：DEV_PLAN 与蓝本冲突时以 DEV_PLAN 为准（MVP 已明确砍掉蓝本的 tool-loop/shell-host 等）。

## 3. 决定与限制

**用户已确认（DEV_PLAN 即用户认可的方案）**：
- LLM 通道：OpenAI 兼容 `/v1/chat/completions` **流式**即可，不要求 tools；默认网页会话（免费），可填官方 API Key 兜底（通道可替换）。
- 网关选型：**ds-free-api（Rust 单文件）为 sidecar 首选**，deeperseeker（Python）备选；main 进程 spawn 管理生命周期。
- "记东西/日程"走**意图解析**（非流式小调用出严格 JSON）不走工具调用；解析失败一律兜底 `chat`，绝不写脏数据。
- 数据库：better-sqlite3（WAL + FTS5），关键词+权重检索，**不引入 embedding**。
- 配置/cookie 存 `%APPDATA%/fairy/`（MVP 明文，阶段 6 上 DPAPI）。

**Agent 自行选择（待用户推翻）**：
- 浮窗 380×560、主窗口底部 tab（日程/记忆/设置）布局、上下文裁剪预算 6000 token 等 DEV_PLAN 参数。
- 阶段 0 采用 electron-vite 模板结构。

**本机硬性限制（附录 C，务必遵守）**：
- Node 24.21.0 位于 `C:\Users\91533\.fairy-tools\node24\node-v24.21.0-win-x64`（用户 PATH 最前；**旧终端不生效**，开新终端或手动拼 PATH）。
- **`ELECTRON_RUN_AS_NODE=1` 陷阱**：会被部分终端继承，导致 electron 退化为纯 Node（无 GUI）。`pnpm dev` 脚本已内置 unset；手动跑 electron 前也要清空。
- github.com 直连不通；electron/electron-builder 二进制走 `registry.npmmirror.com` 镜像；本机 HTTPS 代理 MITM，node 侧需 `NODE_OPTIONS=--use-system-ca`。
- 打包完整命令见附录 C 第 4 条。
- `reference/deepseek-pp` 是嵌套 git 仓库，不提交、不参与构建。

## 4. 进展与运行状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| 阶段 0 脚手架 | ✅ 已完成并验证 | `bf06919`：`pnpm dev` 出窗口+托盘；`release/Fairy Setup 0.0.1.exe`（NSIS ~94MB）已生成验证；单实例锁、外链转系统浏览器已实现（`apps/desktop/src/main/index.ts`） |
| 阶段 1 LLM 桥接通 | ✅ **已完成（2026-09-27）** | 网关 ds-free-api v0.2.11 跑在 127.0.0.1:22217，账号池+device_id 登录成功，流式 curl 验收通过，结论已写入 `docs/llm-bridge-notes.md` |
| 阶段 2 sidecar+登录流 | ⬜ 未开始 | — |
| 阶段 3 会话+聊天 UI | ⬜ 未开始 | — |
| 阶段 4 记忆 | ⬜ 未开始 | — |
| 阶段 5 日程 | ⬜ 未开始 | — |
| 阶段 6 打包硬化 | ⬜ 未开始 | 阶段 0 的 NSIS 已通，硬化项（自启默认勾选/DPAPI/日志）未做 |

代码现状：`apps/desktop` 仅骨架（index.ts 92 行 + React 占位 App）；`packages/core` 仅占位（`src/index.ts` 导出 APP_NAME/FAIRY_VERSION），各子模块（llm/intent/memory/calendar/sessions/store）目录尚未建。无运行中的任务/进程。

**未确认项**：ds-free-api 二进制能否在本机下载/编译（github 直连不通，需代理或 releases 镜像）；用户是否已有 DeepSeek 网页登录 cookie 可用。

## 5. 接续动作

**阶段 1 已完成，下一步 = 阶段 2 sidecar 化 + 登录引导流（DEV_PLAN §6 阶段 2）**：
1. 跑起 LLM 网关：ds-free-api（浏览器 F12 复制 deepseek.com 的 cookie → 写进其 config → 监听 `127.0.0.1:8080`）。若 ds-free-api 下载受阻（网络限制），回退 deeperseeker（Python）。
2. curl 验收：`curl -N http://127.0.0.1:8080/v1/chat/completions`（stream=true，见 DEV_PLAN §6 阶段 1 命令）拿到流式回复。
3. 把结论写入 `docs/llm-bridge-notes.md`：model 取值、**会话过期报错指纹**（HTTP 码+响应体特征）、限速特征。
4. 达成 M0（curl 通），可打 tag `m0`。

**前置条件**：DeepSeek 网页登录 cookie；本机可用的网络（代理/镜像）；开**新终端**使 Node 24.21 生效。
**阻塞风险**：github 直连不通 → 走 npmmirror 镜像或代理；cookie 需用户手动提供。
**验收方法**：DEV_PLAN §6 阶段 1"验收"段。

## 6. 交接简区

- 编号：**H1**
- 源对话：未确认（本机 Pi 会话；标识未获取）
- 已确认目录/动作范围：仅交接保存；业务代码零改动
- 状态：材料已核对，等待接手核验
