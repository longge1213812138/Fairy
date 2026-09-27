/**
 * 阶段 2 IPC 契约 — main ↔ preload ↔ renderer 共享类型。
 * preload 按 FairyApi 暴露 window.fairy；renderer 不直接 import electron。
 */

/** DeepSeek 账号配置（v0.2.11 账号池模式，明文存 %APPDATA%/fairy/config.json，阶段 6 上 DPAPI） */
export interface GatewayAccountConfig {
  /** 邮箱或手机号；纯数字视为手机号（area_code 默认 +86） */
  account: string;
  password: string;
  /** 数美设备指纹，风控必填；取法见 docs/llm-bridge-notes.md §1 */
  deviceId?: string;
}

export type GatewayStatus = 'stopped' | 'starting' | 'ready' | 'error';

/** 账号池登录态（来自网关 stdout 日志扫描） */
export type AccountStatus = 'none' | 'logging_in' | 'logged_in' | 'login_failed' | 'unknown';

export interface GatewayState {
  status: GatewayStatus;
  /** 实际监听端口（随机分配时每次不同） */
  port: number | null;
  /** config.json 是否已配置账号 */
  configured: boolean;
  accountStatus: AccountStatus;
  /** 登录失败原因（如 RISK_DEVICE_DETECTED / USER_IS_BANNED / muted） */
  accountDetail: string | null;
  lastError: string | null;
}

export interface ConfigureResult {
  ok: boolean;
  error?: string;
  state?: GatewayState;
}

export interface TestChatResult {
  ok: boolean;
  content?: string;
  /** 指纹命中持续 429 overloaded → 需要重新配置（托盘红 + 引导卡） */
  expired?: boolean;
  error?: string;
}

/** preload 按此暴露 window.fairy（额外附加 name/version，见 env.d.ts） */
export interface FairyApi {
  gateway: {
    getState(): Promise<GatewayState>;
    configure(input: GatewayAccountConfig): Promise<ConfigureResult>;
    testChat(message: string): Promise<TestChatResult>;
  };
  /** 仅允许 http/https（main 侧校验） */
  openExternal(url: string): Promise<void>;
  /** 订阅网关状态变化，返回退订函数 */
  onGatewayState(cb: (state: GatewayState) => void): () => void;
}
