import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';

const MODEL_NAME = 'gemini-4-hydrogen';
const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite';
const SYSTEM_INSTRUCTION =
  'You are Lumen, a fast, helpful, and accurate AI assistant. Give simple, clear, and to-the-point answers without unnecessary fluff or long introductions unless the user explicitly asks for deep detail. Always respond naturally in the same language as the user.';

const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 6000;
const MAX_SINGLE_HISTORY_CHARS = 1500;
const PRIMARY_COOLDOWN_MS = 120_000;

let cachedAiClient: { apiKey: string; client: GoogleGenAI } | null = null;
let primaryModelCooldownUntil = 0;

interface IncomingHistoryItem {
  role?: string;
  content?: string;
}

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
}

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

type NodeRequest = IncomingMessage & { body?: unknown };

function getAiClient(apiKey: string): GoogleGenAI {
  if (cachedAiClient && cachedAiClient.apiKey === apiKey) {
    return cachedAiClient.client;
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedAiClient = { apiKey, client };
  return client;
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: NodeRequest): Promise<ChatRequestBody> {
  if (req.body && typeof req.body === 'object') {
    return req.body as ChatRequestBody;
  }
  if (typeof req.body === 'string') {
    return (JSON.parse(req.body) as ChatRequestBody) ?? {};
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = 1024 * 1024; // 1MB limit

  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return (JSON.parse(raw) as ChatRequestBody) ?? {};
}

function classifyGeminiError(err: unknown): NormalizedError {
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unexpected error communicating with Gemini API.';

  const statusFromErr =
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;

  const lower = rawMessage.toLowerCase();

  if (
    statusFromErr === 401 ||
    statusFromErr === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('unauthorized')
  ) {
    return {
      status: statusFromErr === 401 ? 401 : 403,
      code: 'API_KEY_INVALID',
      message:
        'Your Gemini API key appears invalid or lacks permission. Please verify GEMINI_API_KEY in your environment variables.',
      retryable: false,
    };
  }

  if (
    statusFromErr === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('429')
  ) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      message:
        'Gemini API rate limit or free-tier quota reached. Please wait a moment and try again.',
      retryable: true,
    };
  }

  if (statusFromErr === 404 || lower.includes('not_found') || lower.includes('is not found')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: `The configured model (${MODEL_NAME}) could not be found or is unavailable.`,
      retryable: false,
    };
  }

  if (statusFromErr === 400 || lower.includes('invalid_argument')) {
    return {
      status: 400,
      code: 'INVALID_REQUEST',
      message:
        'The request could not be processed by Gemini. Please check your message and try again.',
      retryable: false,
    };
  }

  if (
    statusFromErr === 408 ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('aborted')
  ) {
    return {
      status: 504,
      code: 'TIMEOUT',
      message: 'Gemini took too long to respond. Please try again.',
      retryable: true,
    };
  }

  if (
    statusFromErr === 503 ||
    statusFromErr === 502 ||
    statusFromErr === 504 ||
    lower.includes('overloaded') ||
    lower.includes('unavailable') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset')
  ) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Gemini is temporarily busy or unreachable. Please retry in a few seconds.',
      retryable: true,
    };
  }

  return {
    status: statusFromErr && statusFromErr >= 400 && statusFromErr < 600 ? statusFromErr : 500,
    code: 'GEMINI_ERROR',
    message: 'Unable to generate a response right now. Please try again.',
    retryable: true,
  };
}

function buildNormalizedHistory(rawHistory: unknown): Content[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const recentSlice = rawHistory.slice(-MAX_HISTORY_TURNS) as IncomingHistoryItem[];
  const selectedReversed: { role: 'user' | 'model'; text: string }[] = [];
  let charBudget = MAX_HISTORY_CHARS;

  for (let i = recentSlice.length - 1; i >= 0; i--) {
    const item = recentSlice[i];
    if (!item || typeof item.content !== 'string') continue;
    let text = item.content.trim();
    if (!text) continue;

    if (text.length > MAX_SINGLE_HISTORY_CHARS) {
      text = `${text.slice(0, MAX_SINGLE_HISTORY_CHARS)}…`;
    }

    if (charBudget - text.length < 0 && selectedReversed.length > 0) {
      break;
    }

    const role: 'user' | 'model' =
      item.role === 'assistant' || item.role === 'model' ? 'model' : 'user';
    selectedReversed.push({ role, text });
    charBudget -= text.length;
  }

  const ordered = selectedReversed.reverse();
  const normalized: Content[] = [];

  for (const item of ordered) {
    if (normalized.length === 0 && item.role !== 'user') {
      continue;
    }

    const prev = normalized[normalized.length - 1];
    if (prev && prev.role === item.role && prev.parts?.[0] && 'text' in prev.parts[0]) {
      prev.parts[0].text = `${prev.parts[0].text}\n\n${item.text}`;
    } else {
      normalized.push({ role: item.role, parts: [{ text: item.text }] });
    }
  }

  return normalized;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'Method not allowed. Use POST.',
      code: 'METHOD_NOT_ALLOWED',
      retryable: false,
    });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    sendJson(res, 503, {
      error:
        'Gemini API key is not configured. Please set GEMINI_API_KEY in your environment variables.',
      code: 'MISSING_API_KEY',
      retryable: false,
    });
    return;
  }

  let body: ChatRequestBody;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const isTooLarge = err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE';
    sendJson(res, isTooLarge ? 413 : 400, {
      error: isTooLarge ? 'Request payload exceeds 1MB limit.' : 'Invalid JSON request body.',
      code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
      retryable: false,
    });
    return;
  }

  if (typeof body.message !== 'string') {
    sendJson(res, 400, {
      error: 'Message must be a non-empty string.',
      code: 'INVALID_INPUT',
      retryable: false,
    });
    return;
  }

  let message = body.message.trim();
  if (!message) {
    sendJson(res, 400, {
      error: 'Please enter a message before sending.',
      code: 'EMPTY_MESSAGE',
      retryable: false,
    });
    return;
  }

  if (message.length > 32000) {
    sendJson(res, 400, {
      error: 'Message exceeds the 32,000 character limit.',
      code: 'MESSAGE_TOO_LONG',
      retryable: false,
    });
    return;
  }

  const history = buildNormalizedHistory(body.history);
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    const last = history.pop();
    const lastText = last?.parts?.[0] && 'text' in last.parts[0] ? last.parts[0].text : '';
    if (lastText) {
      message = `${lastText}\n\n${message}`;
    }
  }

  const ai = getAiClient(apiKey);

  let clientAborted = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientAborted = true;
    }
  });

  let streamIterable: AsyncIterable<{ text?: string }> | null = null;
  const inCooldown = Date.now() < primaryModelCooldownUntil;
  const modelAttempts = inCooldown ? [FALLBACK_MODEL_NAME] : [MODEL_NAME, FALLBACK_MODEL_NAME];

  for (let i = 0; i < modelAttempts.length; i++) {
    const candidateModel = modelAttempts[i];
    const timeoutMs = candidateModel === MODEL_NAME && i < modelAttempts.length - 1 ? 3200 : 20000;
    try {
      const chat = ai.chats.create({
        model: candidateModel,
        history,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: {
            thinkingLevel:
              candidateModel === MODEL_NAME ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
          },
        },
      });
      streamIterable = await withTimeout(
        chat.sendMessageStream({ message }),
        timeoutMs,
        `Gemini ${candidateModel}`
      );
      break;
    } catch (err) {
      const classified = classifyGeminiError(err);
      if (
        candidateModel === MODEL_NAME &&
        (classified.code === 'SERVICE_UNAVAILABLE' ||
          classified.code === 'TIMEOUT' ||
          classified.code === 'RATE_LIMIT')
      ) {
        primaryModelCooldownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
      }
      const isLastAttempt = i === modelAttempts.length - 1;
      const canFallback =
        !isLastAttempt && (classified.retryable || classified.code === 'MODEL_NOT_FOUND');
      if (!canFallback || clientAborted) {
        console.error('[api/chat] Failed to start Gemini stream:', classified.code, err);
        sendJson(res, classified.status, {
          error: classified.message,
          code: classified.code,
          retryable: classified.retryable,
        });
        return;
      }
    }
  }

  if (!streamIterable) {
    sendJson(res, 500, {
      error: 'Could not initialize Gemini response stream.',
      code: 'STREAM_INIT_FAILED',
      retryable: true,
    });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.();

  try {
    let emittedAnyText = false;
    for await (const chunk of streamIterable) {
      if (clientAborted) {
        break;
      }
      const text = chunk.text ?? '';
      if (text) {
        emittedAnyText = true;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    if (!clientAborted) {
      if (!emittedAnyText) {
        res.write(
          `data: ${JSON.stringify({
            error: 'Gemini returned an empty response. Please try rephrasing your prompt.',
            code: 'EMPTY_RESPONSE',
            retryable: true,
          })}\n\n`
        );
      } else {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
      res.end();
    }
  } catch (err) {
    const classified = classifyGeminiError(err);
    console.error('[api/chat] Stream error:', classified.code, err);
    if (!clientAborted) {
      res.write(
        `data: ${JSON.stringify({
          error: classified.message,
          code: classified.code,
          retryable: classified.retryable,
        })}\n\n`
      );
      res.end();
    }
  }
}
