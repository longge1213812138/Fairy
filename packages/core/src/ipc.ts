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

  // ===== 阶段 3：会话 + 聊天 =====
  sessions: {
    list(): Promise<SessionMeta[]>;
    create(): Promise<SessionMeta>;
    remove(id: string): Promise<void>;
    /** 会话列表需刷新（新建/删除/首条消息改标题等） */
    onChanged(cb: () => void): () => void;
  };
  chat: {
    history(sessionId: string): Promise<MessageDto[]>;
    /** 单飞：同一时刻只允许一条生成中，冲突返回 {ok:false,error} */
    send(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }>;
    /** 中止当前 sessionId 的生成（保留已生成部分） */
    stop(sessionId: string): Promise<void>;
    onDelta(cb: (e: ChatDeltaEvent) => void): () => void;
    onDone(cb: (e: ChatDoneEvent) => void): () => void;
    /** null = 空闲；广播给所有窗口 */
    onBusy(cb: (e: ChatBusyEvent) => void): () => void;
  };
}

// ===== 阶段 3：会话 + 聊天类型 =====

/** 浮窗固定使用的快速会话 id（main 启动时 ensure 存在，kind='quick'） */
export const QUICK_SESSION_ID = 'fairy-quick-session';

export interface SessionMeta {
  id: string;
  /** 首条用户消息前 20 字符自动生成；空串 = 尚无消息 */
  title: string;
  kind: 'chat' | 'quick';
  /** epoch ms */
  createdAt: number;
  updatedAt: number;
}

/** system 提示词不落库（buildContext 时拼接） */
export interface MessageDto {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  /** JSON 对象：{elapsedMs?, finishReason?, aborted?, error?, ...} */
  meta: Record<string, unknown> | null;
  createdAt: number;
}

export interface ChatDeltaEvent {
  sessionId: string;
  /** assistant 占位行 id */
  messageId: number;
  kind: 'content' | 'reasoning';
  text: string;
}

export interface ChatDoneEvent {
  sessionId: string;
  messageId: number;
  ok: boolean;
  /** 用户主动停止（非错误） */
  aborted?: boolean;
  error?: string;
  elapsedMs?: number;
}

export interface ChatBusyEvent {
  /** null = 空闲 */
  sessionId: string | null;
}

/** IPC 通道名（main 注册 / preload 转发，集中在此防拼写漂移） */
export const IPC = {
  sessionList: 'session:list',
  sessionCreate: 'session:create',
  sessionRemove: 'session:remove',
  sessionChanged: 'session:changed',
  chatHistory: 'chat:history',
  chatSend: 'chat:send',
  chatStop: 'chat:stop',
  chatDelta: 'chat:delta',
  chatDone: 'chat:done',
  chatBusy: 'chat:busy'
} as const;
