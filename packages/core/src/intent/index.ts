/**
 * 阶段 4 任务 A2：意图解析（docs/DEV_PLAN.md §5.1，代替工具循环的关键）。
 *
 * 每条用户消息进聊天流水线前先做 1 次非流式小调用分类：
 *   remember / forget / chat（schedule_* 留给阶段 5，prompt 刻意不含相关词，
 *   避免模型提前输出无法处理的 intent）。
 * 解析容错：提取第一个 balanced {...}（容忍 ```json 围栏与前后废话）；
 * 任何异常（网络/超时/Abort/坏 JSON/非法 intent/空 payload）一律兜底 chat，绝不抛错、绝不写脏数据。
 */

import type { ChatMessage, LlmClient } from '../llm/types';

export type IntentKind = 'remember' | 'forget' | 'chat';

export interface IntentResult {
  intent: IntentKind;
  payload?: { content?: string; keyword?: string };
}

export interface IntentParser {
  parse(message: string, opts?: { signal?: AbortSignal; now?: Date }): Promise<IntentResult>;
}

/** §5.1：短 prompt（<300 token），注入当前时间，只输出 JSON */
function buildSystemPrompt(now: Date): string {
  return [
    '你是意图分类器。判断用户想做什么，只输出一个 JSON，不要解释，不要 Markdown 代码围栏。',
    `当前时间: ${now.toISOString()}`,
    'intent 只能取以下三种值：',
    '- remember：用户想让你长期记住某条信息。payload.content = 记忆内容（去掉「记住」「记一下」「帮我记」「请记住」等命令词后的信息本体）。',
    '- forget：用户想删除已记住的信息。payload.keyword = 要删除的关键词。',
    '- chat：以上两种之外的一切（闲聊、提问、普通指令）。',
    '输出示例（三选一）：',
    '{"intent":"remember","payload":{"content":"喜欢简洁回答"}}',
    '{"intent":"forget","payload":{"keyword":"咖啡"}}',
    '{"intent":"chat"}'
  ].join('\n');
}

/** 从 start 起找第一个 brace 平衡（字符串/转义感知）的 JSON 切片终点下标；找不到返回 -1 */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 提取第一个能 JSON.parse 的 balanced {...}；都不行返回 undefined */
function extractFirstJson(text: string): unknown {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = findBalancedEnd(text, start);
    if (end === -1) continue;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // 不是合法 JSON → 试下一个 {
    }
  }
  return undefined;
}

function pickText(payload: unknown, key: string): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 校验 + 兜底：非法 intent / 空 payload 一律 chat */
function toIntentResult(parsed: unknown): IntentResult {
  if (parsed === null || typeof parsed !== 'object') return { intent: 'chat' };
  const obj = parsed as Record<string, unknown>;
  const intent = obj.intent;

  if (intent === 'remember') {
    const content = pickText(obj.payload, 'content');
    return content === null ? { intent: 'chat' } : { intent: 'remember', payload: { content } };
  }
  if (intent === 'forget') {
    const keyword = pickText(obj.payload, 'keyword');
    return keyword === null ? { intent: 'chat' } : { intent: 'forget', payload: { keyword } };
  }
  // chat 与其余一切（intent 非法/缺失）都兜底 chat
  return { intent: 'chat' };
}

/** 依赖注入 LlmClient（core/llm 的 createLlmClient 返回值），便于用假 client 单测 */
export function createIntentParser(client: LlmClient): IntentParser {
  return {
    async parse(message, opts) {
      const system = buildSystemPrompt(opts?.now ?? new Date());
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: message }
      ];
      try {
        const result = await client.chatOnce(messages, { signal: opts?.signal });
        return toIntentResult(extractFirstJson(result?.content ?? ''));
      } catch {
        // 网络/超时/Abort 一律兜底 chat（stop 由外层 signal 继续控制流式阶段）
        return { intent: 'chat' };
      }
    }
  };
}
