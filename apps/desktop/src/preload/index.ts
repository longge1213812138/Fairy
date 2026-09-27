import { contextBridge, ipcRenderer } from 'electron'
import { APP_NAME, FAIRY_VERSION, IPC } from '@fairy/core'
import type {
  ChatBusyEvent,
  ChatDeltaEvent,
  ChatDoneEvent,
  ConfigureResult,
  FairyApi,
  GatewayAccountConfig,
  GatewayState,
  MessageDto,
  SessionMeta,
  TestChatResult
} from '@fairy/core'

/**
 * 阶段 3 完整 FairyApi（按 @fairy/core ipc.ts 契约，通道名一律用 IPC 常量）。
 * 事件订阅统一 ipcRenderer.on(channel, (_e, payload) => cb(payload)) 包装并返回退订函数。
 * renderer 不直接 import electron，只经此边界访问 main。
 */

/** 事件订阅包装：返回退订函数 */
function onEvent<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld(
  'fairy',
  ({
    name: APP_NAME,
    version: FAIRY_VERSION,

    gateway: {
      getState: (): Promise<GatewayState> => ipcRenderer.invoke('gateway:getState'),
      configure: (input: GatewayAccountConfig): Promise<ConfigureResult> =>
        ipcRenderer.invoke('gateway:configure', input),
      testChat: (message: string): Promise<TestChatResult> =>
        ipcRenderer.invoke('gateway:testChat', message)
    },

    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),

    // 'gateway:state' 为阶段 2 遗留通道（不在 IPC 常量表，保持兼容）
    onGatewayState: (cb: (state: GatewayState) => void): (() => void) =>
      onEvent<GatewayState>('gateway:state', cb),

    sessions: {
      list: (): Promise<SessionMeta[]> => ipcRenderer.invoke(IPC.sessionList),
      create: (): Promise<SessionMeta> => ipcRenderer.invoke(IPC.sessionCreate),
      remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.sessionRemove, id),
      onChanged: (cb: () => void): (() => void) => onEvent<void>(IPC.sessionChanged, () => cb())
    },

    chat: {
      history: (sessionId: string): Promise<MessageDto[]> =>
        ipcRenderer.invoke(IPC.chatHistory, sessionId),
      send: (sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke(IPC.chatSend, sessionId, text),
      stop: (sessionId: string): Promise<void> => ipcRenderer.invoke(IPC.chatStop, sessionId),
      onDelta: (cb: (e: ChatDeltaEvent) => void): (() => void) =>
        onEvent<ChatDeltaEvent>(IPC.chatDelta, cb),
      onDone: (cb: (e: ChatDoneEvent) => void): (() => void) =>
        onEvent<ChatDoneEvent>(IPC.chatDone, cb),
      onBusy: (cb: (e: ChatBusyEvent) => void): (() => void) =>
        onEvent<ChatBusyEvent>(IPC.chatBusy, cb)
    }
  } as unknown as FairyApi & { name: string; version: string })
)
