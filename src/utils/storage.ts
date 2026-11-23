import type { ChatMessage, Conversation, StorageSaveResult, ThemeMode } from '../types/chat';

const CONVERSATIONS_KEY = 'lumen_chat_conversations_v1';
const ACTIVE_CONVERSATION_KEY = 'lumen_chat_active_id_v1';
const THEME_KEY = 'lumen_chat_theme_v1';

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deriveTitleFromMessage(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'New Conversation';
  if (cleaned.length <= 44) return cleaned;

  const sliced = cleaned.slice(0, 44);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatRelativeTime(timestamp: number): string {
  const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSeconds < 60) return 'Just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function deduplicateMessages(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  const seenIds = new Set<string>();
  const result: ChatMessage[] = [];

  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') continue;
    const msg = item as Partial<ChatMessage>;
    if (
      typeof msg.id !== 'string' ||
      (msg.role !== 'user' && msg.role !== 'assistant') ||
      typeof msg.content !== 'string' ||
      typeof msg.createdAt !== 'number'
    ) {
      continue;
    }
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    result.push({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      updatedAt: typeof msg.updatedAt === 'number' ? msg.updatedAt : undefined,
      isError: Boolean(msg.isError),
      errorCode: typeof msg.errorCode === 'string' ? msg.errorCode : undefined,
      retryable: typeof msg.retryable === 'boolean' ? msg.retryable : undefined,
    });
  }

  return result;
}

export function deduplicateConversations(conversations: Conversation[]): Conversation[] {
  const seen = new Set<string>();
  const clean: Conversation[] = [];

  for (const conv of conversations) {
    if (!conv || typeof conv.id !== 'string' || seen.has(conv.id)) continue;
    seen.add(conv.id);
    clean.push({
      id: conv.id,
      title: typeof conv.title === 'string' && conv.title.trim() ? conv.title.trim() : 'Untitled Chat',
      createdAt: typeof conv.createdAt === 'number' ? conv.createdAt : Date.now(),
      updatedAt: typeof conv.updatedAt === 'number' ? conv.updatedAt : Date.now(),
      messages: deduplicateMessages(conv.messages),
    });
  }

  return clean.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return deduplicateConversations(parsed as Conversation[]);
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): StorageSaveResult {
  if (typeof window === 'undefined') return { ok: true };
  try {
    const deduplicated = deduplicateConversations(conversations);
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(deduplicated));
    return { ok: true };
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {
      ok: false,
      error: isQuota
        ? 'Browser storage quota exceeded. Delete older conversations to continue saving history.'
        : 'Unable to save chat history to browser storage.',
    };
  }
}

export function loadActiveConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
  } catch {
    // Ignore storage write errors for active pointer
  }
}

export function loadTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Default to light
  }
  return 'light';
}

export function saveTheme(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage errors
  }
}
