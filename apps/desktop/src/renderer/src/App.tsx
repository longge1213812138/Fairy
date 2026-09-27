import { APP_NAME, FAIRY_VERSION } from '@fairy/core'
import { useState } from 'react'

type Tab = 'chat' | 'calendar' | 'memory' | 'settings'

const TABS: { key: Tab; label: string; phase: string }[] = [
  { key: 'chat', label: '聊天', phase: '阶段 3' },
  { key: 'calendar', label: '日程', phase: '阶段 5' },
  { key: 'memory', label: '记忆', phase: '阶段 4' },
  { key: 'settings', label: '设置', phase: '阶段 2' }
]

function App() {
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <div className="shell">
      <header className="titlebar">
        <span className="logo">🧚 {APP_NAME}</span>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'tab active' : 'tab'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="version">v{FAIRY_VERSION} · 阶段 0 骨架</span>
      </header>

      <main className="content">
        {tab === 'chat' && (
          <div className="placeholder">
            <h2>聊天</h2>
            <p>会话系统与流式问答将在<strong>阶段 3</strong>实现（见 docs/DEV_PLAN.md §5.4）。</p>
          </div>
        )}
        {tab === 'calendar' && (
          <div className="placeholder">
            <h2>日程</h2>
            <p>自然语言日程管理 + 托盘提醒将在<strong>阶段 5</strong>实现（§5.3）。</p>
          </div>
        )}
        {tab === 'memory' && (
          <div className="placeholder">
            <h2>记忆</h2>
            <p>FTS5 自动沉淀与注入将在<strong>阶段 4</strong>实现（§5.2）。</p>
          </div>
        )}
        {tab === 'settings' && (
          <div className="placeholder">
            <h2>设置</h2>
            <p>DeepSeek 登录引导流（粘贴 cookie → 探活）将在<strong>阶段 2</strong>实现（§5.5）。</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
