export type MessageRole = 'user' | 'assistant';

export type ThemeMode = 'light' | 'dark';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  updatedAt?: number;
  isError?: boolean;
  errorCode?: string;
  retryable?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface StorageSaveResult {
  ok: boolean;
  error?: string;
}
