/**
 * renderer ⇄ main 的 IPC 边界（DEV_PLAN §6 阶段 2 + 阶段 3）。
 *
 * handlers：
 * - 阶段 2：gateway:getState / gateway:configure / gateway:testChat / app:openExternal
 * - 阶段 3：会话 CRUD 与聊天（通道名一律用 @fairy/core 的 IPC 常量，勿手写字符串）：
 *   session:list / session:create / session:remove / chat:history / chat:send / chat:stop
 * 事件广播：
 * - 网关状态：sidecar onState → broadcast('gateway:state')，300ms 去抖合并（'gateway:state' 为阶段 2 遗留通道名，不在 IPC 常量表，保持兼容）
 * - 聊天事件（delta/done/busy）与会话变化（session:changed）由 chat.ts 直接走 windows.broadcast
 * 托盘：login_failed → 红图标 + 异常 tooltip（tray 实例由 index.ts 创建后经 registerTray 注入）。
 */
import { app, ipcMain, nativeImage, shell } from 'electron'
import type { Tray } from 'electron'
import { join } from 'node:path'
import { IPC, APP_NAME, FAIRY_VERSION } from '@fairy/core'
import type { GatewayAccountConfig, GatewayState } from '@fairy/core'
import {
  createSession,
  listHistory,
  listSessions,
  removeSession,
  sendChat,
  stopChat
} from './chat'
import { broadcast } from './windows'
import { configureGateway, getGatewayState, onGatewayStateChanged, testChat } from './sidecar'

let tray: Tray | null = null
let normalIcon: Electron.NativeImage | null = null
let redIcon: Electron.NativeImage | null = null
let iconsResolved = false

function iconsDir(): string {
  // 开发态：项目 resources/；打包后：extraResources（与 windows.ts iconPath() 规则一致）
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

function ensureIcons(): void {
  if (iconsResolved) return
  iconsResolved = true
  normalIcon = nativeImage.createFromPath(join(iconsDir(), 'icon.png'))
  redIcon = nativeImage.createFromPath(join(iconsDir(), 'icon-red.png'))
}

/** tray 实例由 index.ts 创建后注入；保持 index.ts 简洁 */
export function registerTray(t: Tray): void {
  tray = t
  ensureIcons()
}

/** login_failed（含 getGatewayState 派生的会话过期）→ 托盘红 + 异常 tooltip；否则恢复 */
export function setTrayState(state: GatewayState): void {
  if (!tray) return
  ensureIcons()
  if (state.accountStatus === 'login_failed') {
    tray.setImage(redIcon?.isEmpty() ? nativeImage.createEmpty() : (redIcon ?? nativeImage.createEmpty()))
    tray.setToolTip(`🧚 ${APP_NAME} · 会话异常（点击打开设置）`)
  } else {
    tray.setImage(normalIcon?.isEmpty() ? nativeImage.createEmpty() : (normalIcon ?? nativeImage.createEmpty()))
    tray.setToolTip(`${APP_NAME} v${FAIRY_VERSION}`)
  }
}

export function registerIpcHandlers(): void {
  // ===== 阶段 2：网关 / 外链 =====
  ipcMain.handle('gateway:getState', () => getGatewayState())
  ipcMain.handle('gateway:configure', (_event, input: GatewayAccountConfig) => configureGateway(input))
  ipcMain.handle('gateway:testChat', (_event, message: string) => testChat(message))

  // 外链一律系统浏览器；只放行 http/https，其他协议 reject
  ipcMain.handle('app:openExternal', async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('URL 必须为字符串')
    let protocol = ''
    try {
      protocol = new URL(url).protocol
    } catch {
      throw new Error(`无法解析 URL：${url}`)
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`拒绝打开非 http/https 链接：${url}`)
    }
    await shell.openExternal(url)
  })

  // ===== 阶段 3：会话 + 聊天（通道名用 IPC 常量；store 操作在 chat.ts） =====
  ipcMain.handle(IPC.sessionList, () => listSessions())
  ipcMain.handle(IPC.sessionCreate, () => createSession())
  ipcMain.handle(IPC.sessionRemove, (_event, id: unknown) => {
    if (typeof id !== 'string' || id === '') throw new Error('session id 必须为非空字符串')
    removeSession(id)
  })
  ipcMain.handle(IPC.chatHistory, (_event, id: unknown, limit?: unknown) => {
    if (typeof id !== 'string') throw new Error('session id 必须为字符串')
    return listHistory(id, typeof limit === 'number' ? limit : undefined)
  })
  ipcMain.handle(IPC.chatSend, (_event, id: unknown, text: unknown) => {
    if (typeof id !== 'string') return { ok: false, error: '参数错误' }
    return sendChat(id, typeof text === 'string' ? text : '')
  })
  ipcMain.handle(IPC.chatStop, (_event, id: unknown) => {
    if (typeof id !== 'string') return
    return stopChat(id)
  })

  // 网关状态广播：sidecar onState → 全窗口 send；300ms 去抖合并高频变化
  let pending: GatewayState | null = null
  let timer: NodeJS.Timeout | null = null
  onGatewayStateChanged((state) => {
    pending = state
    setTrayState(state) // 托盘立即更新，不等去抖
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      if (!pending) return
      const snapshot = pending
      pending = null
      broadcast('gateway:state', snapshot)
    }, 300)
  })
}
