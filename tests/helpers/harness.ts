import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

/**
 * A responder is called each time the assistant emits a text block.
 * Return a string to send as the next user message (mid-session response to a prompt).
 * Return null to not respond; the SDK will finish the current turn and the session will end.
 */
export type PromptResponder = (assistantText: string) => string | null;

export interface RunSkillOptions {
  cwd: string;
  prompt: string;
  onPrompt: PromptResponder;
  maxTurns?: number;
}

export interface RunSkillResult {
  toolUses: ToolUse[];
  assistantText: string[];
  finalResponse: string;
}

/**
 * Drive a Claude Code SDK session headlessly, feeding user messages via a
 * streaming-input async iterable so the harness can respond to assistant
 * prompts mid-session.
 *
 * SDK API notes (claude-agent-sdk 0.2.119):
 *  - `query({ prompt, options })` returns a `Query` which is an
 *    `AsyncGenerator<SDKMessage>`. There is no `session.input()` method on
 *    the stable `Query` interface; to inject further user messages we pass
 *    `prompt` as an `AsyncIterable<SDKUserMessage>` and push onto it.
 *  - `permissionMode: 'bypassPermissions'` requires
 *    `allowDangerouslySkipPermissions: true` (safety guard).
 *  - `settingSources: ['user']` picks up `~/.claude/skills/frigade-engage`
 *    (and other user-level skills). Without it the SDK runs in isolation
 *    mode and the skill is invisible.
 *  - Assistant message content blocks use the BetaMessage shape: each block
 *    is either `{ type: 'text', text: string }` or
 *    `{ type: 'tool_use', name: string, input: unknown }`.
 *  - A `result` message (subtype `success` | `error_*`) marks the end of a
 *    turn. When our input iterable is exhausted, the session ends after the
 *    current turn's result.
 */
export async function runSkill(opts: RunSkillOptions): Promise<RunSkillResult> {
  const toolUses: ToolUse[] = [];
  const assistantText: string[] = [];
  let finalResponse = '';

  // Queue-backed AsyncIterable<SDKUserMessage>. The SDK drains this as
  // user turns; when we call `queue.close()` and the queue is empty, the
  // iterable's `next()` resolves with `{ done: true }` and the session ends
  // after the in-flight turn's `result` message.
  const queue = createMessageQueue();
  queue.push(makeUserMessage(opts.prompt));

  try {
    const session = query({
      prompt: queue.iterable,
      options: {
        cwd: opts.cwd,
        settingSources: ['user'],
        maxTurns: opts.maxTurns ?? 40,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of session) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            const text = block.text;
            assistantText.push(text);
            finalResponse = text;
            const response = opts.onPrompt(text);
            if (response !== null) {
              queue.push(makeUserMessage(response));
            }
          } else if (block.type === 'tool_use') {
            toolUses.push({
              name: block.name,
              input: (block.input ?? {}) as Record<string, unknown>,
            });
          }
        }
      } else if (message.type === 'result') {
        // A turn ended. If the caller didn't queue a follow-up user message
        // for this turn's prompts, we're done — close the input iterable so
        // the SDK terminates cleanly.
        if (queue.isEmpty()) {
          queue.close();
        }
      }
    }
  } finally {
    // Defensive: ensure the queue is closed even if the loop threw.
    queue.close();
  }

  return { toolUses, assistantText, finalResponse };
}

function makeUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: randomUUID(),
  };
}

interface MessageQueue {
  iterable: AsyncIterable<SDKUserMessage>;
  push(msg: SDKUserMessage): void;
  close(): void;
  isEmpty(): boolean;
}

/**
 * A simple producer/consumer async queue. Items pushed before the consumer
 * awaits are buffered; once `close()` is called and the buffer is drained,
 * the iterator returns `{ done: true }`.
 */
function createMessageQueue(): MessageQueue {
  const buffer: SDKUserMessage[] = [];
  const waiters: Array<(v: IteratorResult<SDKUserMessage>) => void> = [];
  let closed = false;

  const push = (msg: SDKUserMessage) => {
    if (closed) return;
    const w = waiters.shift();
    if (w) {
      w({ value: msg, done: false });
    } else {
      buffer.push(msg);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      const w = waiters.shift()!;
      w({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  };

  const iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
          }
          return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<SDKUserMessage>> {
          close();
          return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
        },
      };
    },
  };

  return { iterable, push, close, isEmpty: () => buffer.length === 0 };
}

// ---- helpers used by tests -------------------------------------------------

export const CANONICAL_PROMPT = /^About to (.+?) in (dev|prod)\. Confirm\? \(y\/n\)$/m;

export function matchConfirmation(
  text: string,
): { verb: string; env: 'dev' | 'prod' } | null {
  const m = text.match(CANONICAL_PROMPT);
  if (!m) return null;
  return { verb: m[1], env: m[2] as 'dev' | 'prod' };
}

export const KEY_PROMPT_PATTERNS: Array<{
  label: string;
  regex: RegExp;
  envKey: string;
}> = [
  { label: 'dev public', regex: /dev.*public.*key/i, envKey: 'FRIGADE_TEST_API_KEY_PUBLIC' },
  { label: 'dev secret', regex: /dev.*(secret|private).*key/i, envKey: 'FRIGADE_TEST_API_KEY_SECRET' },
  { label: 'prod public', regex: /prod.*public.*key/i, envKey: 'FRIGADE_TEST_API_KEY_PUBLIC_PROD' },
  { label: 'prod secret', regex: /prod.*(secret|private).*key/i, envKey: 'FRIGADE_TEST_API_KEY_SECRET_PROD' },
];

export function answerKeyPrompt(text: string): string | null {
  for (const p of KEY_PROMPT_PATTERNS) {
    if (p.regex.test(text)) {
      const v = process.env[p.envKey];
      if (!v) {
        throw new Error(
          `Env var ${p.envKey} is required to answer key prompt "${p.label}"`,
        );
      }
      return v;
    }
  }
  return null;
}
