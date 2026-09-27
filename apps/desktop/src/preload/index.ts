import { contextBridge } from 'electron'
import { APP_NAME, FAIRY_VERSION } from '@fairy/core'

// 阶段 0：仅暴露版本信息；IPC 边界（chat/memory/calendar/settings）在后续阶段补齐
contextBridge.exposeInMainWorld('fairy', {
  name: APP_NAME,
  version: FAIRY_VERSION
})
