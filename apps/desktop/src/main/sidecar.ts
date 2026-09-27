/**
 * LLM 网关 sidecar 生命周期管理（DEV_PLAN §6 阶段 2）。
 *
 * - 用 @fairy/core 的 createGatewayManager 托管 ds-free-api 子进程；
 *   configPath = <userData>/gateway/config.toml，dataDir = <userData>/gateway-data。
 * - getGatewayState() 是唯一状态出口（snapshot → GatewayState 映射 + 派生规则），
 *   ipc.ts / 托盘都从这里取数。
 * - 二进制缺失 / 未配置账号时不 spawn，维护固定的 error snapshot（语义见 initSidecar 注释）。
 * - 状态变化通过 onGatewayStateChanged 注入的监听器广播（由 ipc.ts 注册，
 *   避免 ipc.ts ↔ sidecar.ts 循环 import）。
 */
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createGatewayManager,
  createLlmClient,
  LlmAuthError,
  SessionExpiredError,
} from '@fairy/core'
import type {
  ConfigureResult,
  GatewayAccountConfig,
  GatewayManager,
  GatewaySnapshot,
  GatewayState,
  TestChatResult,
} from '@fairy/core'
import { loadConfig, saveConfig } from './config'

let manager: GatewayManager | null = null
let inited = false
/** testChat 命中会话过期指纹（持续 429 overloaded）置 true；configure 成功 / testChat 成功清 false */
let lastTestExpired = false
/** 二进制缺失 / 未配置账号时不 spawn：维护固定 error snapshot，getGatewayState 优先用它 */
let fallbackSnapshot: GatewaySnapshot | null = null

type StateListener = (state: GatewayState) => void
let stateListener: StateListener | null = null

/** catch 分支取错误文案（避免依赖并行导出的错误类收窄） */
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** ipc.ts 在启动时注册（300ms 去抖广播 + setTrayState）；返回退订函数 */
export function onGatewayStateChanged(cb: StateListener): () => void {
  stateListener = cb
  return () => {
    if (stateListener === cb) stateListener = null
  }
}

function emitState(): void {
  stateListener?.(getGatewayState())
}

/** whenReady 调用。幂等。 */
export function initSidecar(): void {
  if (inited) return
  inited = true

  const userData = app.getPath('userData')
  const configPath = join(userData, 'gateway', 'config.toml')
  const dataDir = join(userData, 'gateway-data')
  mkdirSync(join(userData, 'gateway'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  const cfg = loadConfig()
  const binPath = cfg.gatewayBin ?? ''
  const hasBin = binPath !== '' && existsSync(binPath)

  manager = createGatewayManager({
    binPath,
    configPath,
    dataDir,
    apiKey: cfg.apiKey,
    account: cfg.account ?? null,
  })

  manager.onState(() => {
    // manager 开始出真实状态（启动 / reconfigure 触发）→ 废弃 fallback，跟随 manager
    fallbackSnapshot = null
    emitState()
  })

  if (!hasBin) {
    // 语义：二进制缺失 → 不 spawn，网关永远 error，提示用户放置 ds-free-api.exe
    fallbackSnapshot = {
      status: 'error',
      port: null,
      accountStatus: 'none',
      accountDetail: null,
      lastError: '未找到网关二进制',
    }
    return
  }
  if (!cfg.account) {
    // 语义：未配置账号（首启用户走 §5.5 引导流）→ 不 spawn 避免空账号池无意义登录
    fallbackSnapshot = {
      status: 'error',
      port: null,
      accountStatus: 'none',
      accountDetail: null,
      lastError: '未配置账号',
    }
    return
  }

  // 不 await：不阻塞 whenReady；失败由 getSnapshot() 体现，catch 仅防 unhandledRejection
  void manager
    .start()
    .catch((err: unknown) => {
      fallbackSnapshot = {
        status: 'error',
        port: null,
        accountStatus: 'none',
        accountDetail: null,
        lastError: `网关启动失败：${errMsg(err)}`,
      }
      emitState()
    })
}

/**
 * snapshot → GatewayState（ipc / 托盘的唯一取数口）。
 * `configured` 来自 config.json 是否有 account；
 * 派生规则集中在本函数（注释）：lastTestExpired 且网关仍认为 logged_in
 * （会话过期只在请求时暴露）→ 降级 login_failed，驱动托盘红 + 引导卡。
 */
export function getGatewayState(): GatewayState {
  const snap =
    fallbackSnapshot ??
    manager?.getSnapshot() ?? {
      status: 'stopped',
      port: null,
      accountStatus: 'none',
      accountDetail: null,
      lastError: null,
    }
  const configured = loadConfig().account !== undefined

  const state: GatewayState = {
    status: snap.status,
    port: snap.port,
    configured,
    accountStatus: snap.accountStatus,
    accountDetail: snap.accountDetail,
    lastError: snap.lastError,
  }

  if (lastTestExpired && snap.accountStatus === 'logged_in') {
    state.accountStatus = 'login_failed'
    state.accountDetail = '会话过期（持续 429 overloaded），请重新保存账号配置'
  }
  return state
}

/** 保存账号配置 → 重启 sidecar；deviceId 为空不阻断，但提示 RISK_DEVICE_DETECTED 风险 */
export async function configureGateway(input: GatewayAccountConfig): Promise<ConfigureResult> {
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.account !== 'string' ||
    input.account.trim() === '' ||
    typeof input.password !== 'string' ||
    input.password === ''
  ) {
    return { ok: false, error: '账号和密码必填' }
  }

  const cfg = loadConfig()
  const account: GatewayAccountConfig = {
    account: input.account.trim(),
    password: input.password,
  }
  if (typeof input.deviceId === 'string' && input.deviceId.trim() !== '') {
    account.deviceId = input.deviceId.trim()
  }

  try {
    saveConfig({ ...cfg, account })
  } catch (err) {
    return {
      ok: false,
      error: `配置写入失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  lastTestExpired = false // configure 成功 → 清过期标记

  try {
    if (manager) {
      await manager.reconfigure({ account })
      fallbackSnapshot = null // reconfigure 后跟随 manager 快照
    }
    const state = getGatewayState()
    if (!account.deviceId) {
      // 风险提示（不阻断）：缺 device_id 可能触发 RISK_DEVICE_DETECTED 风控
      state.accountDetail = '未提供 device_id：登录可能被风控拦截（RISK_DEVICE_DETECTED），建议补充'
    }
    return { ok: true, state }
  } catch (err) {
    const state = getGatewayState()
    return {
      ok: false,
      error: state.lastError ?? state.accountDetail ?? String(err),
      state,
    }
  }
}

/** 设置页「测试对话」端到端探活：直连网关 /v1/chat/completions（非流式） */
export async function testChat(message: string): Promise<TestChatResult> {
  const state = getGatewayState()
  if (state.status !== 'ready' || state.port === null) {
    return { ok: false, error: '网关未就绪' }
  }
  if (typeof message !== 'string' || message.trim() === '') {
    return { ok: false, error: '消息为空' }
  }

  const cfg = loadConfig()
  const client = createLlmClient({
    baseUrl: `http://127.0.0.1:${state.port}`,
    apiKey: cfg.apiKey,
  })

  try {
    const res = await client.chatOnce([{ role: 'user', content: message }])
    lastTestExpired = false // testChat 成功 → 清过期标记
    return { ok: true, content: res.content }
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      lastTestExpired = true
      return {
        ok: false,
        expired: true,
        error: '会话已过期（持续 429 overloaded），请重新保存账号配置',
      }
    }
    if (err instanceof LlmAuthError) {
      return { ok: false, error: `API Key 无效：${errMsg(err)}` }
    }
    return { ok: false, error: errMsg(err) }
  }
}

let stopping = false

/** 退出时调用：manager.stop() 幂等 + 3s 兜底超时（卡死的网关不阻塞 app.exit） */
export async function shutdownSidecar(): Promise<void> {
  if (!manager || stopping) return
  stopping = true
  const timeout = new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      console.warn('[sidecar] 网关停止超时（3s），强制退出')
      resolve()
    }, 3000)
    t.unref?.()
  })
  try {
    await Promise.race([manager.stop(), timeout])
  } catch (err) {
    console.warn('[sidecar] stop 异常，继续退出:', errMsg(err))
  }
}
