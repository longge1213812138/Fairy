import { app, shell, BrowserWindow, Tray, Menu, nativeImage, Notification } from 'electron'
import { join } from 'node:path'
import { APP_NAME, FAIRY_VERSION } from '@fairy/core'
import { initUserDataPath } from './config'
import { initSidecar, shutdownSidecar } from './sidecar'
import { registerIpcHandlers, registerTray, sendStateOnFinishLoad } from './ipc'

// DEV_PLAN §7：尽早把 userData 指到 %APPDATA%/fairy（小写 fairy），必须先于一切读取 userData 的逻辑
initUserDataPath()

let win: BrowserWindow | null = null
let tray: Tray | null = null

function iconPath(): string {
  // 开发态：项目 resources/；打包后：extraResources
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources/icon.png')
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 980,
    height: 640,
    show: false,
    title: `${APP_NAME} ${FAIRY_VERSION}`,
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win?.show())

  // 外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 窗口加载完成晚于状态变化时补发一次网关状态
  sendStateOnFinishLoad(win.webContents)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip(`${APP_NAME} v${FAIRY_VERSION}`)

  // 托盘状态更新（红图标）逻辑注入 ipc.ts，保持本文件简洁
  registerTray(tray)

  const autoStart = app.getLoginItemSettings().openAtLogin

  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => (win?.show() ?? createWindow()) },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: autoStart,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { type: 'separator' },
    {
      label: `关于 ${APP_NAME}`,
      click: () =>
        new Notification({
          title: APP_NAME,
          body: `版本 ${FAIRY_VERSION}（阶段 2）`
        }).show()
    },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => (win?.show() ?? createWindow()))
}

// 单实例锁：防止多开导致 sidecar/数据文件竞争
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => win?.show())
  app.whenReady().then(() => {
    createWindow()
    createTray()
    registerIpcHandlers()
    initSidecar()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// 退出前停掉网关子进程（防 Windows 僵尸进程）；幂等防重入，3s 兜底超时在 shutdownSidecar 内
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) {
    event.preventDefault()
    return
  }
  shuttingDown = true
  event.preventDefault()
  shutdownSidecar().finally(() => app.exit())
})

app.on('window-all-closed', () => {
  // MVP：留在托盘常驻；阶段 6 再加"是否退出"逻辑
})
