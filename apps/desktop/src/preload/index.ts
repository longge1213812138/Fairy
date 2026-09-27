import { contextBridge, ipcRenderer } from 'electron'
import { APP_NAME, FAIRY_VERSION } from '@fairy/core'
import type { FairyApi, GatewayAccountConfig, GatewayState } from '@fairy/core'

// 阶段 2：完整 FairyApi（gateway 状态/配置/探活 + 外链 + 状态订阅）
// 类型断言为 FairyApi & { name; version }；renderer 只能经此边界访问 main
contextBridge.exposeInMainWorld(
  'fairy',
  ({
    name: APP_NAME,
    version: FAIRY_VERSION,
    gateway: {
      getState: (): Promise<GatewayState> => ipcRenderer.invoke('gateway:getState'),
      configure: (input: GatewayAccountConfig): Promise<unknown> =>
        ipcRenderer.invoke('gateway:configure', input),
      testChat: (message: string): Promise<unknown> => ipcRenderer.invoke('gateway:testChat', message),
    },
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
    onGatewayState: (cb: (state: GatewayState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: GatewayState) => cb(state)
      ipcRenderer.on('gateway:state', listener)
      return () => {
        ipcRenderer.removeListener('gateway:state', listener)
      }
    },
  } as unknown as FairyApi & { name: string; version: string })
)
