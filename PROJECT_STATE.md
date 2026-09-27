# Fairy 项目交接材料

> 交接编号：H4 ｜ 状态：**阶段 4 代码完成，待 GUI 验收（阶段 3 同）** ｜ 更新时间：2026-09-27
> 工作目录（绝对路径）：`C:\Users\91533\Desktop\Fairy`

## 1. 任务与版本

- **目标**：Fairy = Windows 桌面私人助手，以 **DeepSeek 网页版**（chat.deepseek.com 会话）为 LLM 后端，零 API 成本。MVP 范围 F1–F7 见 `docs/DEV_PLAN.md` §1。
- **范围（MVP）**：聊天（流式）、多会话、"帮我记东西"、日程+托盘通知、FTS5 长期记忆、托盘/Alt+Space 浮窗/开机自启、登录引导流。明确不做：工具循环/Agent/Shell、Skill、MCP、云同步、多用户、cron 引擎。
- **完成标准**：里程碑 M0–M4（见 DEV_PLAN §9），当前 **M0 已达成；阶段 2/3/4 代码完成（待人工 GUI 验收后打 m1、m2）**。
- **git 位置**：历史：
  - `bf06919` 阶段 0：pnpm workspace + Electron 骨架 + 图标 + NSIS 打包通过
  - `b9932fe` docs：附录 C 本机环境备忘
  - `5573a02` + tag `m0`：阶段 1 LLM 桥接通（docs/llm-bridge-notes.md）
  - `075937f` 阶段 2：sidecar 化 + 登录引导流
  - `011a6e9`/`fdf536d` 阶段 3：会话系统 + 聊天 UI + 双窗口
  - `129c655` 阶段 4：记忆（FTS5）+ 意图解析管线
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
- 配置/凭据存 `%APPDATA%/fairy/config.json`（账号+密码+device_id，MVP 明文，阶段 6 上 DPAPI）。

**Agent 自行选择（待用户推翻）**：
- 浮窗 380×560、主窗口底部 tab（日程/记忆/设置）布局、上下文裁剪预算 6000 token 等 DEV_PLAN 参数。
- 阶段 0 采用 electron-vite 模板结构。

**本机硬性限制（附录 C，务必遵守）**：
- Node 24.21.0 位于 `C:\Users\91533\.fairy-tools\node24\node-v24.21.0-win-x64`（用户 PATH 最前；**旧终端不生效**，开新终端或手动拼 PATH）。
- **`ELECTRON_RUN_AS_NODE=1` 陷阱**：会被部分终端继承，导致 electron 退化为纯 Node（无 GUI）。`pnpm dev` 脚本已内置 unset；手动跑 electron 前也要清空。
- github.com 当前可直连（2026-09-27 验证 200；历史交接记录的“直连不通”已失效）；electron/electron-builder 二进制仍走 npmmirror 镜像；本机 HTTPS 代理 MITM，node 侧需 `NODE_OPTIONS=--use-system-ca`。
- 打包完整命令见附录 C 第 4 条。
- `reference/deepseek-pp` 是嵌套 git 仓库，不提交、不参与构建。

## 4. 进展与运行状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| 阶段 0 脚手架 | ✅ 已完成并验证 | `bf06919`：`pnpm dev` 出窗口+托盘；`release/Fairy Setup 0.0.1.exe`（NSIS ~94MB）已生成验证；单实例锁、外链转系统浏览器已实现（`apps/desktop/src/main/index.ts`） |
| 阶段 1 LLM 桥接通 | ✅ **已完成（2026-09-27）** | 网关 ds-free-api v0.2.11 跑在 127.0.0.1:22217，账号池+device_id 登录成功，流式 curl 验收通过，结论已写入 `docs/llm-bridge-notes.md` |
| 阶段 2 sidecar+登录流 | ✅ **代码完成（2026-09-27），待人工 GUI 验收** | core：`llm/`（流式/退避/SessionExpired 指纹，单测 25 绿含真实网关集成）+ `gateway/`（spawn/日志扫描/taskkill 树杀）；main：`config.ts`（config.json + 一次性迁移）/`sidecar.ts`/`ipc.ts`/托盘红图标；设置页四步引导流+测试对话；build 产物曾因 `@fairy/core` 外部化崩溃→已改 `externalizeDepsPlugin({exclude:['@fairy/core']})`+renderer 走 `index.web.ts` |
| 阶段 3 会话+聊天 UI | ✅ **代码完成（2026-09-27），待人工 GUI 验收** | core：`store/`（WAL+版本化迁移 fail-visible）+ `sessions/`（CRUD/自动标题/9000 字符裁剪/quick 会话），测试 48/48 绿；main：`windows.ts`（浮窗预建/Esc+blur 收起）+ `hotkeys.ts`（Alt+Space 失败降级）+ `chat.ts`（单飞流式编排，delta/done/busy 广播，stop 保留部分，过期→托盘红）；renderer：底部 tab + 会话侧栏 + ChatPane（react-markdown 流式、停止按钮、浮窗 `?float=1`） |
| 阶段 4 记忆 | ✅ **代码完成（2026-09-27），待人工 GUI 验收** | 迁移 v2（memories+trigram FTS+触发器，真实库 v1→v2 烟测升级成功）；意图 remember/forget/chat（失败兜底 chat）；检索三层候选+coverage×kind权重×0.95^天衰减 top-8（验收召回场景有单测）；chat 三步管线+空闲 5min 抽取；记忆面板（五色筛选/增删改/导出导入/onChanged 实时刷新）；测试 97/97 绿 |
| 阶段 5 日程 | ⬜ 未开始 | — |
| 阶段 6 打包硬化 | ⬜ 未开始 | 阶段 0 的 NSIS 已通，硬化项（自启默认勾选/DPAPI/日志）未做 |

代码现状：`packages/core` 含 llm/gateway/sessions/store/memory/intent（阶段 2-4）；main 含 config/sidecar/ipc/chat/extract/windows/hotkeys；renderer 含 ChatPane/SessionSidebar/MemoryPanel/SettingsTab + 底部 tab。**尚未做**：calendar（阶段 5）、打包硬化（阶段 6）。无运行中的任务/进程（烟测已清理）。

**已解决/已知事实**（原“未确认项”已全部落地）：ds-free-api v0.2.11 本机下载+运行 OK；账号池+device_id 登录 OK（凭据在 `%APPDATA%/fairy/config.json` 与 `~/.fairy-tools/.../config.toml`，明文，勿入 git）。

## 5. 接续动作

**阶段 4 代码已完成，下一步 = ① GUI 验收（阶段 2/3/4 合并） → 打 tag `m1`（阶段2-3）与 `m2`（阶段4） → ② 阶段 5 日程（DEV_PLAN §6 阶段 5）**：

**① GUI 验收清单（阶段 2/3/4 合并，DEV_PLAN §6 各阶段验收 + §9 M2）**：
1. `pnpm dev`（新终端，Node 24，`ELECTRON_RUN_AS_NODE` 未被继承）。
2. **聊天（阶段 3）**：底部 tab；新建/切换/删除 10 个会话；流式 markdown；停止按钮保留已生成部分；**Alt+Space 浮窗**问答、Esc 收起；重启后历史完整。
3. **设置（阶段 2）**：测试对话绿卡；改坏密码→保存→托盘红+红卡→改回恢复；托盘退出后无 ds-free-api 残留。
4. **记忆（阶段 4，M2 验收）**：
   - 聊天说「记住：我喝美式不加糖」→ 回复开头有确认语；**新开会话**问「我咖啡怎么喝」→ 答案能引用该记忆；
   - 记忆面板出现该条（kind=note）；删掉后新会话再问 → 不再引用；
   - 面板手动新增/编辑/筛选/搜索/导出 JSON/导入同文件（应显示 skipped 去重）；
   - 闲聊后等 5 分钟（或下轮对话前）观察抽取入库 preference/fact 类记忆（面板 onChanged 刷新）；
   - 连续聊 10+ 轮，面板误入库目测可接受（prompt 可调，DEV_PLAN §6 阶段 4 验收第 3 条）。
5. 通过后：`git tag m1 m2`。

**② 阶段 5 开工要点**：`core/calendar` + `events` 表（迁移 v3）、意图扩展 `schedule_add/done/cancel/query`（§5.1 prompt 加四个 intent + remind_at ISO 换算与合法性校验 + 一次追问）、`main/notify-loop.ts`（30s 轮询 → Notification → fired=1；退出前提示未触发日程）、日程面板（今天/明天/全部、勾选完成、手动增删）。

**注意事项**：意图 prompt 目前只有 remember/forget/chat（schedule 词刻意未出现，阶段 5 加入）；空闲抽取是全局单例 5min 定时器（发消息/新 done 重置，忙则顺延 1min）；记忆检索数据量大时可将兜底全扫换纯 FTS（trigram 已建索引）；面板列表 limit=200 无分页；`buildContext` 的 systemExtra 由 main 拼（core 不感知 memory）；`.pi/` 已入 .gitignore；生成中切走再切回占位为空、bundle >500kB 等阶段 3 遗留仍有效；`electron-builder.yml` 已设 `npmRebuild: false`，阶段 6 打包需补 extraResources（红图标+网关二进制）。

## 6. 交接简区

- 编号：**H4**（H1-H3 阶段 1-3 已完成归档）
- 源对话：本机 Pi 会话
- 状态：阶段 4 代码完成 + 97 测试全绿 + build/烟测（v1→v2 迁移）通过，待 GUI 验收后打 m1/m2、继续阶段 5
