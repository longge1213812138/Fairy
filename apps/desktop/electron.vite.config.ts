import { join } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @fairy/core 直接以 TS 源码方式引入，由 electron-vite 统一编译
const coreSrc = join(__dirname, '../../packages/core/src/index.ts')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@fairy/core': coreSrc }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@fairy/core': coreSrc }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@fairy/core': coreSrc,
        '@renderer': join(__dirname, 'src/renderer/src')
      }
    }
  }
})
