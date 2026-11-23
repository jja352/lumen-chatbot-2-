import type { ChatMessage } from '../types/chat';

const MAX_CLIENT_HISTORY_TURNS = 10;
const MAX_CLIENT_HISTORY_CHARS = 6000;
const MAX_SINGLE_MESSAGE_CHARS = 1500;
const REQUEST_TIMEOUT_MS = 25000;

export class ChatApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(message: string, code = 'API_ERROR', status = 500, retryable = true) {
    super(message);
    this.name = 'ChatApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

interface StreamChatParams {
  message: string;
  history: Pick<ChatMessage, 'role' | 'content' | 'isError'>[];
  signal?: AbortSignal;
  onChunk: (accumulatedText: string, delta: string) => void;
}

function buildCompactHistory(
  history: Pick<ChatMessage, 'role' | 'content' | 'isError'>[]
): { role: string; content: string }[] {
  const valid = history.filter((m) => !m.isError && m.content.trim().length > 0);
  const recent = valid.slice(-MAX_CLIENT_HISTORY_TURNS);
  const selectedReversed: { role: string; content: string }[] = [];
  let charBudget = MAX_CLIENT_HISTORY_CHARS;

  for (let i = recent.length - 1; i >= 0; i--) {
    let text = recent[i].content.trim();
    if (text.length > MAX_SINGLE_MESSAGE_CHARS) {
      text = `${text.slice(0, MAX_SINGLE_MESSAGE_CHARS)}…`;
    }
    if (charBudget - text.length < 0 && selectedReversed.length > 0) {
      break;
    }
    selectedReversed.push({ role: recent[i].role, content: text });
    charBudget -= text.length;
  }

  return selectedReversed.reverse();
}

export async function streamChatResponse({
  message,
  history,
  signal,
  onChunk,
}: StreamChatParams): Promise<string> {
  const compactHistory = buildCompactHistory(history);

  const timeoutController = new AbortController();
  let timedOut = false;

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, REQUEST_TIMEOUT_MS);

  const handleCallerAbort = () => {
    timeoutController.abort();
  };

  if (signal) {
    if (signal.aborted) {
      window.clearTimeout(timeoutId);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', handleCallerAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: compactHistory }),
      signal: timeoutController.signal,
    });
  } catch (err) {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleCallerAbort);

    if (timedOut) {
      throw new ChatApiError(
        'The request timed out while waiting for Gemini. Please try again.',
        'TIMEOUT',
        504,
        true
      );
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new ChatApiError(
      'Network connection failed. Please check your internet connection and try again.',
      'NETWORK_ERROR',
      0,
      true
    );
  }

  if (!response.ok) {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleCallerAbort);

    let errorMessage =
      response.status === 404
        ? 'Chat API endpoint (/api/chat) was not found. Please refresh the page or ensure the app server is running.'
        : `Request failed with status ${response.status}.`;
    let errorCode = response.status === 404 ? 'ENDPOINT_NOT_FOUND' : 'HTTP_ERROR';
    let retryable = response.status >= 500 || response.status === 429 || response.status === 404;

    try {
      const payload = (await response.json()) as {
        error?: string;
        code?: string;
        retryable?: boolean;
      };
      if (payload.error) errorMessage = payload.error;
      if (payload.code) errorCode = payload.code;
      if (typeof payload.retryable === 'boolean') retryable = payload.retryable;
    } catch {
      // Non-JSON response body (for example static fallback or proxy 404)
    }

    throw new ChatApiError(errorMessage, errorCode, response.status, retryable);
  }

  if (!response.body) {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleCallerAbort);
    throw new ChatApiError('Server returned an empty response stream.', 'EMPTY_STREAM', 500, true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const rawEvent of events) {
        const lines = rawEvent.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonText = line.slice(6).trim();
          if (!jsonText) continue;

          let payload: {
            text?: string;
            done?: boolean;
            error?: string;
            code?: string;
            retryable?: boolean;
          };
          try {
            payload = JSON.parse(jsonText);
          } catch {
            continue;
          }

          if (payload.error) {
            throw new ChatApiError(
              payload.error,
              payload.code ?? 'STREAM_ERROR',
              500,
              payload.retryable ?? true
            );
          }

          if (typeof payload.text === 'string' && payload.text.length > 0) {
            accumulated += payload.text;
            onChunk(accumulated, payload.text);
          }
        }
      }
    }

    if (buffer.trim().startsWith('data: ')) {
      const jsonText = buffer.trim().slice(6).trim();
      try {
        const payload = JSON.parse(jsonText) as {
          text?: string;
          error?: string;
          code?: string;
          retryable?: boolean;
        };
        if (payload.error) {
          throw new ChatApiError(
            payload.error,
            payload.code ?? 'STREAM_ERROR',
            500,
            payload.retryable ?? true
          );
        }
        if (typeof payload.text === 'string' && payload.text.length > 0) {
          accumulated += payload.text;
          onChunk(accumulated, payload.text);
        }
      } catch (err) {
        if (err instanceof ChatApiError) throw err;
      }
    }

    return accumulated;
  } catch (err) {
    if (timedOut) {
      throw new ChatApiError(
        'The response stream timed out. Please try again.',
        'TIMEOUT',
        504,
        true
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleCallerAbort);
  }
}
