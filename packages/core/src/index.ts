/**
 * @fairy/core — Fairy 助手核心逻辑（纯 TypeScript，不依赖 Electron）。
 *
 * 阶段 2：llm/（OpenAI 兼容客户端）、gateway/（sidecar 管理器）、IPC 契约。
 * 渲染层请用 index.web.ts（本入口含 node 内建依赖，仅供 main/preload）。
 * 后续阶段按 docs/DEV_PLAN.md 填充：sessions/、memory/、calendar/、intent/、store/
 */

export * from './constants';
export * from './ipc';
export * from './llm';
export * from './gateway';
