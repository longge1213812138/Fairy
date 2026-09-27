import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConfigureResult,
  GatewayAccountConfig,
  GatewayState,
  TestChatResult
} from '@fairy/core'

/** 设备指纹取法（docs/llm-bridge-notes.md §1）：Chrome F12 Console 执行后自动复制输出 */
const FINGERPRINT_CMD = 'copy(SMSdk.getDeviceId())'
const DEEPSEEK_URL = 'https://chat.deepseek.com'

/**
 * 阶段 2：设置页 — DeepSeek 账号配置引导流（账号池 + device_id，非 cookie）。
 *
 * 数据来源：`window.fairy`（preload 按 FairyApi 暴露，契约见 packages/core/src/ipc.ts）：
 * - 状态：onGatewayState 事件 + 挂载时 getState + 5s 轮询兜底
 * - 表单：契约中 getState 不返回账号明文，故打开页面时表单初始留空
 * - 完成态：state.status==='ready' && accountStatus==='logged_in'
 */
export default function SettingsTab() {
  const [gw, setGw] = useState<GatewayState | null>(null)

  // 账号表单
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [deviceId, setDeviceId] = useState('')

  const [saving, setSaving] = useState(false)
  const [cfgResult, setCfgResult] = useState<ConfigureResult | null>(null)

  const [testMsg, setTestMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestChatResult | null>(null)

  const [copied, setCopied] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const accountRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setGw(await window.fairy.gateway.getState())
    } catch {
      // main 侧未就绪时忽略，由事件/下一轮轮询补齐
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.fairy.onGatewayState((s: GatewayState) => setGw(s))
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [refresh])

  const done = gw?.status === 'ready' && gw.accountStatus === 'logged_in'

  const handleSave = async () => {
    if (!account.trim() || !password.trim() || saving) return
    setSaving(true)
    setCfgResult(null)
    setTestResult(null)
    try {
      const input: GatewayAccountConfig = {
        account: account.trim(),
        password: password.trim()
      }
      if (deviceId.trim()) input.deviceId = deviceId.trim()
      setCfgResult(await window.fairy.gateway.configure(input))
    } finally {
      setSaving(false)
    }
  }

  /** 登录失败（login_failed）时：滚回表单重新保存 */
  const handleResave = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    accountRef.current?.focus()
  }

  const handleTest = async () => {
    const msg = testMsg.trim()
    if (!msg || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.fairy.gateway.testChat(msg))
    } finally {
      setTesting(false)
    }
  }

  const handleCopyCmd = async () => {
    try {
      await navigator.clipboard.writeText(FINGERPRINT_CMD)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const handleOpenPage = () => {
    void window.fairy.openExternal(DEEPSEEK_URL)
  }

  const statusCard = gw ? (
    <StatusCard gw={gw} onResave={handleResave} />
  ) : (
    <div className="status-card card-neutral">
      <p className="card-title">网关状态加载中…</p>
    </div>
  )

  const testBlock = (
    <div className="test-block">
      <div className="test-row">
        <input
          className="test-input"
          value={testMsg}
          onChange={(e) => setTestMsg(e.target.value)}
          placeholder="一句话说说你是谁"
        />
        <button className="btn" onClick={() => void handleTest()} disabled={testing || !testMsg.trim()}>
          {testing ? '运行中…' : '测试对话'}
        </button>
      </div>
      {testResult?.ok && (
        <div className="status-card card-green">
          <p className="card-title">✓ 测试成功，网关链路正常</p>
          <p className="card-detail">{testResult.content}</p>
        </div>
      )}
      {testResult && !testResult.ok && testResult.expired && (
        <div className="status-card card-red">
          <p className="card-title">会话过期，请重新保存账号配置</p>
          <p className="card-hint">命中过期指纹（持续 429 overloaded）：重新填写账号/密码/device_id 并保存，或重新获取 device_id 后再测试。</p>
        </div>
      )}
      {testResult && !testResult.ok && !testResult.expired && (
        <div className="status-card card-red">
          <p className="card-title">测试失败：{testResult.error ?? '未知错误'}</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="settings">
      <h2>设置 · DeepSeek 账号</h2>

      {statusCard}

      {done ? (
        <div className="steps-done">
          <div className="status-card card-green">
            <p className="card-title">✓ 引导已完成：账号已配置，网关运行正常。可随时用下方测试对话验证链路。</p>
          </div>
          {testBlock}
        </div>
      ) : (
        <ol className="steps">
          <li>
            <strong>步骤一：打开 DeepSeek 网页</strong>
            <p>取设备指纹需要访问该页面（<strong>无需登录</strong>），等待页面完全加载即可。</p>
            <button className="btn" onClick={handleOpenPage}>
              打开 DeepSeek 网页
            </button>
          </li>

          <li>
            <strong>步骤二：获取并复制设备指纹（device_id）</strong>
            <p>
              在刚打开的页面按 F12 → 切到 Console → 粘贴下方命令并回车，输出会自动复制；回到这里粘贴到 device_id 框。
              device_id 是设备级指纹，同机器多账号可复用，一次获取长期有效。
            </p>
            <div className="cmd-row">
              <code className="cmd">{FINGERPRINT_CMD}</code>
              <button className="btn" onClick={() => void handleCopyCmd()}>
                {copied ? '已复制 ✓' : '复制取指纹命令'}
              </button>
            </div>
          </li>

          <li>
            <strong>步骤三：填写账号并保存</strong>
            <form
              className="setting-form"
              ref={formRef}
              onSubmit={(e) => {
                e.preventDefault()
                void handleSave()
              }}
            >
              <div>
                <label>账号（邮箱或手机号；纯数字按手机号处理，默认 +86）</label>
                <input
                  ref={accountRef}
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="如 yourname@example.com 或 13800000000"
                  autoComplete="off"
                />
              </div>
              <div>
                <label>密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="DeepSeek 账号密码"
                  autoComplete="off"
                />
              </div>
              <div>
                <label>device_id（可选，强烈建议填写）</label>
                <input
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  placeholder="粘贴步骤二取到的指纹；不填可能触发 RISK_DEVICE_DETECTED 风控"
                  autoComplete="off"
                />
              </div>
              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !account.trim() || !password.trim()}
                >
                  {saving ? '保存中…' : '保存并启动网关'}
                </button>
              </div>
            </form>
            {cfgResult?.ok && (
              <p className="inline-msg msg-ok">
                ✓ 已保存（网关状态：{cfgResult.state?.status ?? '未知'}）
              </p>
            )}
            {cfgResult && !cfgResult.ok && (
              <p className="inline-msg msg-err">✗ 保存失败：{cfgResult.error}</p>
            )}
          </li>

          <li>
            <strong>步骤四：测试对话（探活验证）</strong>
            {testBlock}
          </li>
        </ol>
      )}
    </div>
  )
}

/** 状态卡：绿（就绪）/ 红（登录失败/网关错误）/ 黄（未配置）/ 中性（启动中/未知） */
function StatusCard({ gw, onResave }: { gw: GatewayState; onResave: () => void }) {
  // 顺序关键：未配置优先于 error —— 首启 fallback 是 status:'error'+lastError:'未配置账号'，
  // 若先判 error 会显示红卡而非黄色引导卡（阶段 2 修复）
  if (!gw.configured) {
    return (
      <div className="status-card card-yellow">
        <p className="card-title">未配置 DeepSeek 账号</p>
        <p className="card-hint">
          请按下方 4 步完成配置：① 打开 DeepSeek 网页 → ② 复制设备指纹 → ③ 填写账号/密码/device_id 并保存 →
          ④ 测试对话验证。网关状态里不含账号明文，表单需要每次手动填写。
        </p>
      </div>
    )
  }

  if (gw.status === 'error') {
    return (
      <div className="status-card card-red">
        <p className="card-title">网关错误</p>
        {gw.lastError && <p className="card-detail">{gw.lastError}</p>}
      </div>
    )
  }

  if (gw.status === 'starting') {
    return (
      <div className="status-card card-neutral">
        <p className="card-title">网关启动中…</p>
      </div>
    )
  }

  if (gw.accountStatus === 'login_failed') {
    return (
      <div className="status-card card-red">
        <p className="card-title">账号登录失败：{gw.accountDetail ?? '未知原因'}</p>
        <p className="card-hint">
          可能原因：device_id 缺失或风控拦截（RISK_DEVICE_DETECTED）、账号封禁（USER_IS_BANNED）、临时禁言（muted）。
          请核对表单各字段后重新保存。
        </p>
        <button className="btn" onClick={onResave}>
          重新保存账号配置
        </button>
      </div>
    )
  }

  if (gw.status === 'ready' && gw.accountStatus === 'logged_in') {
    return (
      <div className="status-card card-green">
        <p className="card-title">已就绪 · 端口 {gw.port}</p>
      </div>
    )
  }

  return (
    <div className="status-card card-neutral">
      <p className="card-title">网关就绪（端口 {gw.port ?? '未知'}）· 账号状态 {gw.accountStatus}</p>
    </div>
  )
}
