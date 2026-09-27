/**
 * 聊天流式编排（DEV_PLAN §6 阶段 3，main 进程侧）。
 *
 * - initChat()（whenReady 调，幂等）：建会话存储 SQLite <userData>/fairy.db + ensure 快速会话。
 * - 单飞：模块级 active，同一时刻只允许一条生成；sendChat 冲突直接返回 {ok:false,error}。
 * - 流水：user 落库 → assistant 空占位（拿 messageId）→ 广播 busy → streamChat；
 *   回调累积本地 buffer 并广播 delta（content/reasoning 都发，渲染层自决定展示）。
 * - 完成/中止/过期/其他错误 → updateMessage 保留已生成部分 + meta，广播 chatDone。
 * - 广播统一走 windows.broadcast（主窗口 + 浮窗同步）。
 *
 * 依赖单向：chat → windows / sidecar / config（均不回 import chat）。
 * createSessionStore/SessionStore 为并行任务 A 在 @fairy/core 的冻结签名。
 */
import { app } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  createLlmClient,
  createSessionStore,
  SessionExpiredError
} from '@fairy/core'
import type {
  ChatBusyEvent,
  ChatDeltaEvent,
  ChatDoneEvent,
  MessageDto,
  SessionMeta,
  SessionStore
} from '@fairy/core'
import { loadConfig } from './config'
import { getGatewayState, reportSessionExpired, reportSessionOk } from './sidecar'
import { broadcast } from './windows'

let store: SessionStore | null = null

/** 单飞：同一时刻只有一条生成中（AbortController 供 stopChat 中止） */
let active: { sessionId: string; controller: AbortController } | null = null

/** whenReady 调用，幂等 */
export function initChat(): void {
  if (store) return
  store = createSessionStore({ dbPath: join(app.getPath('userData'), 'fairy.db') })
  store.ensureQuickSession() // 浮窗固定快速会话（QUICK_SESSION_ID）
}

function requireStore(): SessionStore {
  if (!store) throw new Error('chat store 未初始化（initChat 应先于 IPC handler 注册）')
  return store
}

// ===== 会话 CRUD（ipc.ts handler 直调；session:changed 广播在此统一） =====

export function listSessions(): SessionMeta[] {
  return requireStore().listSessions()
}

export function createSession(): SessionMeta {
  const meta = requireStore().createSession('chat')
  broadcast(IPC.sessionChanged)
  return meta
}

export function removeSession(id: string): void {
  requireStore().removeSession(id)
  broadcast(IPC.sessionChanged)
}

export function listHistory(sessionId: string, limit?: number): MessageDto[] {
  return requireStore().listMessages(sessionId, limit)
}

// ===== 发送 / 停止 =====

/**
 * 校验（空消息 / 网关未就绪 / 已有生成中 / 会话不存在）→ 否则落库并启动生成。
 * 返回 {ok:true} 只代表「已受理」；流式结果经 chat:delta / chat:done 事件推送。
 */
export function sendChat(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof text !== 'string' || text.trim() === '') {
    return Promise.resolve({ ok: false, error: '消息不能为空' })
  }

  const gw = getGatewayState()
  if (gw.status !== 'ready' || gw.port === null) {
    return Promise.resolve({ ok: false, error: '网关未就绪，请先在设置页完成配置' })
  }
  if (active) {
    return Promise.resolve({ ok: false, error: '正在生成回复…' })
  }
  if (requireStore().getSession(sessionId) === null) {
    return Promise.resolve({ ok: false, error: '会话不存在' })
  }

  // user 消息落库（任务 A 约定：该会话首条消息会自动改标题）→ 会话列表全窗口刷新
  requireStore().appendMessage({ sessionId, role: 'user', content: text })
  broadcast(IPC.sessionChanged)

  // assistant 空占位，拿 messageId 供 delta/done 事件与最终 updateMessage 使用
  const placeholder = requireStore().appendMessage({ sessionId, role: 'assistant', content: '' })
  const messageId = placeholder.id

  const controller = new AbortController()
  active = { sessionId, controller }
  broadcast(IPC.chatBusy, { sessionId } satisfies ChatBusyEvent)
  reportSessionOk() // 消息成功进入生成流水 → 清会话过期标记（托盘联动）

  void runGeneration(sessionId, messageId, gw.port, controller.signal)
  return Promise.resolve({ ok: true })
}

/** 中止 active 且 sessionId 匹配的生成；不匹配静默（单飞保证当前生成即 active） */
export function stopChat(sessionId: string): Promise<void> {
  if (active && active.sessionId === sessionId) {
    active.controller.abort()
  }
  return Promise.resolve()
}

// ===== 生成流水 =====

async function runGeneration(
  sessionId: string,
  messageId: number,
  port: number,
  signal: AbortSignal
): Promise<void> {
  const s = requireStore()
  const client = createLlmClient({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: loadConfig().apiKey
  })
  // buildContext 含刚落的 user 消息（system 提示词在 core 内拼接，不落库）
  const messages = s.buildContext(sessionId)
  const startedAt = Date.now()

  let content = ''
  let reasoning = ''

  const emitDelta = (kind: ChatDeltaEvent['kind'], text: string): void => {
    broadcast(IPC.chatDelta, { sessionId, messageId, kind, text } satisfies ChatDeltaEvent)
  }
  const emitDone = (event: ChatDoneEvent): void => {
    broadcast(IPC.chatDone, event)
  }

  try {
    const result = await client.streamChat(
      messages,
      {
        onContentDelta: (t) => {
          content += t
          emitDelta('content', t)
        },
        onReasoningDelta: (t) => {
          reasoning += t
          emitDelta('reasoning', t)
        }
      },
      { signal }
    )
    const elapsedMs = Date.now() - startedAt
    s.updateMessage(messageId, {
      content: content || result.content,
      // reasoning 也留痕（meta JSON），主窗口重开会话时可自行决定展示
      meta: {
        elapsedMs,
        finishReason: result.finishReason ?? 'stop',
        ...(reasoning ? { reasoning } : {})
      }
    })
    emitDone({ sessionId, messageId, ok: true, elapsedMs })
  } catch (err) {
    const elapsedMs = Date.now() - startedAt

    if (isAbortError(err, signal)) {
      // 用户主动 stop：保留已生成部分，非错误
      s.updateMessage(messageId, { content, meta: { aborted: true, elapsedMs } })
      emitDone({ sessionId, messageId, ok: true, aborted: true, elapsedMs })
      return
    }

    if (err instanceof SessionExpiredError) {
      // 会话过期（持续 429 overloaded）：保留部分 + 托盘红联动
      s.updateMessage(messageId, { content, meta: { error: err.message } })
      emitDone({
        sessionId,
        messageId,
        ok: false,
        error: '会话已过期（持续 429 overloaded），请在设置页重新保存账号配置',
        elapsedMs
      })
      reportSessionExpired()
      return
    }

    const message = err instanceof Error ? err.message : String(err)
    s.updateMessage(messageId, { content, meta: { error: message } })
    emitDone({ sessionId, messageId, ok: false, error: message, elapsedMs })
  } finally {
    active = null
    broadcast(IPC.chatBusy, { sessionId: null } satisfies ChatBusyEvent)
  }
}

/** LLM 客户端对 AbortSignal 的两种兑现方式：signal.reason（Error）或 DOMException AbortError */
function isAbortError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return err instanceof DOMException && err.name === 'AbortError'
}
