import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  Check,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  SquarePen,
  Sun,
  X,
} from 'lucide-react';
import { Composer } from './components/Composer';
import { ConfirmModal } from './components/ConfirmModal';
import { MessageItem } from './components/MessageItem';
import { Sidebar } from './components/Sidebar';
import { ChatApiError, streamChatResponse } from './services/chatApi';
import type { ChatMessage, Conversation, ThemeMode } from './types/chat';
import {
  createId,
  deriveTitleFromMessage,
  loadActiveConversationId,
  loadConversations,
  loadTheme,
  saveActiveConversationId,
  saveConversations,
  saveTheme,
} from './utils/storage';

const STARTER_PROMPTS = [
  {
    title: 'Explain a complex topic',
    prompt: 'Explain how HTTPS and TLS handshakes keep web traffic secure in simple steps.',
  },
  {
    title: 'Write TypeScript code',
    prompt: 'Write a clean, reusable TypeScript debounce hook for React with cleanup.',
  },
  {
    title: 'Draft a clear message',
    prompt: 'Draft a concise project status update email sharing progress and next milestones.',
  },
  {
    title: 'Multilingual translation',
    prompt:
      'Translate "Welcome to our platform, let us know if you need help" into Spanish, French, and Japanese.',
  },
];

type DeleteTarget =
  | { kind: 'single'; conversation: Conversation }
  | { kind: 'all' }
  | null;

function getInitialWorkspace(): { conversations: Conversation[]; activeId: string | null } {
  const savedList = loadConversations();
  const savedActive = loadActiveConversationId();
  const activeId =
    savedActive && savedList.some((c) => c.id === savedActive)
      ? savedActive
      : savedList[0]?.id ?? null;
  return { conversations: savedList, activeId };
}

export default function App() {
  const [initialWorkspace] = useState(getInitialWorkspace);
  const [conversations, setConversations] = useState<Conversation[]>(
    initialWorkspace.conversations
  );
  const [activeId, setActiveId] = useState<string | null>(initialWorkspace.activeId);

  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [composerResetNonce, setComposerResetNonce] = useState(0);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const [isHeaderRenaming, setIsHeaderRenaming] = useState(false);
  const [headerDraftTitle, setHeaderDraftTitle] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const streamingConvIdRef = useRef(streamingConvId);
  streamingConvIdRef.current = streamingConvId;

  const abortControllerRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveTheme(theme);
  }, [theme]);

  // Persist conversations to Local Storage (defer during active token streaming to keep UI snappy)
  useEffect(() => {
    if (streamingMsgId !== null) return;
    const result = saveConversations(conversations);
    if (!result.ok && result.error) {
      setStorageError(result.error);
    } else {
      setStorageError(null);
    }
  }, [conversations, streamingMsgId]);

  // Persist active conversation pointer
  useEffect(() => {
    saveActiveConversationId(activeId);
  }, [activeId]);

  // Focus header title input when renaming
  useEffect(() => {
    if (isHeaderRenaming && headerInputRef.current) {
      headerInputRef.current.focus();
      headerInputRef.current.select();
    }
  }, [isHeaderRenaming]);

  // Reset header rename state when switching conversations
  useEffect(() => {
    setIsHeaderRenaming(false);
    shouldAutoScrollRef.current = true;
    setShowScrollButton(false);
  }, [activeId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // Auto-scroll when active conversation messages change or stream updates
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom(streamingMsgId ? 'auto' : 'smooth');
    }
  }, [activeConversation?.messages, streamingMsgId, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom < 120;
    shouldAutoScrollRef.current = nearBottom;
    const msgCount =
      conversationsRef.current.find((c) => c.id === activeIdRef.current)?.messages.length ?? 0;
    setShowScrollButton(!nearBottom && msgCount > 0);
  }, []);

  const handleStopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isGeneratingRef.current = false;
    setStreamingConvId(null);
    setStreamingMsgId(null);
  }, []);

  const handleNewChat = useCallback(() => {
    if (isGeneratingRef.current) {
      handleStopGenerating();
    }
    setActiveId(null);
    setComposerResetNonce((n) => n + 1);
    setIsHeaderRenaming(false);
  }, [handleStopGenerating]);

  const runGeminiTurn = useCallback(
    async ({
      conversationId,
      userPrompt,
      history,
      assistantMsgId,
    }: {
      conversationId: string;
      userPrompt: string;
      history: ChatMessage[];
      assistantMsgId: string;
    }) => {
      if (isGeneratingRef.current) return;

      isGeneratingRef.current = true;
      setStreamingConvId(conversationId);
      setStreamingMsgId(assistantMsgId);
      shouldAutoScrollRef.current = true;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let latestText = '';
      let chunkRafId: number | null = null;

      const applyStreamText = (text: string, touchUpdatedAt: boolean) => {
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== conversationId) return conv;
            return {
              ...conv,
              updatedAt: touchUpdatedAt ? Date.now() : conv.updatedAt,
              messages: conv.messages.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, content: text } : msg
              ),
            };
          })
        );
      };

      try {
        const finalText = await streamChatResponse({
          message: userPrompt,
          history,
          signal: controller.signal,
          onChunk: (accumulatedText) => {
            latestText = accumulatedText;
            if (chunkRafId === null) {
              chunkRafId = requestAnimationFrame(() => {
                chunkRafId = null;
                applyStreamText(latestText, false);
              });
            }
          },
        });

        if (chunkRafId !== null) {
          cancelAnimationFrame(chunkRafId);
          chunkRafId = null;
        }
        applyStreamText(finalText || latestText, true);
      } catch (err) {
        if (chunkRafId !== null) {
          cancelAnimationFrame(chunkRafId);
          chunkRafId = null;
        }

        if (err instanceof DOMException && err.name === 'AbortError') {
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== conversationId) return conv;
              const target = conv.messages.find((m) => m.id === assistantMsgId);
              if (target && target.content.trim() === '' && latestText.trim() === '') {
                return {
                  ...conv,
                  updatedAt: Date.now(),
                  messages: conv.messages.filter((m) => m.id !== assistantMsgId),
                };
              }
              return {
                ...conv,
                updatedAt: Date.now(),
                messages: conv.messages.map((m) =>
                  m.id === assistantMsgId && latestText ? { ...m, content: latestText } : m
                ),
              };
            })
          );
          return;
        }

        const errorMessage =
          err instanceof ChatApiError
            ? err.message
            : 'An unexpected error occurred while contacting Gemini.';
        const errorCode = err instanceof ChatApiError ? err.code : 'UNKNOWN_ERROR';
        const retryable = err instanceof ChatApiError ? err.retryable : true;

        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== conversationId) return conv;
            return {
              ...conv,
              updatedAt: Date.now(),
              messages: conv.messages.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      content: errorMessage,
                      isError: true,
                      errorCode,
                      retryable,
                    }
                  : msg
              ),
            };
          })
        );
      } finally {
        if (chunkRafId !== null) {
          cancelAnimationFrame(chunkRafId);
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        isGeneratingRef.current = false;
        setStreamingConvId(null);
        setStreamingMsgId(null);
      }
    },
    []
  );

  const handleSendMessage = useCallback(
    async (rawPrompt: string) => {
      const promptText = rawPrompt.trim();
      if (!promptText || isGeneratingRef.current) return;

      const now = Date.now();
      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        content: promptText,
        createdAt: now,
      };
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        createdAt: now + 1,
      };

      let targetConversationId = activeIdRef.current;
      let priorMessages: ChatMessage[] = [];

      if (!targetConversationId) {
        const newConv: Conversation = {
          id: createId(),
          title: deriveTitleFromMessage(promptText),
          createdAt: now,
          updatedAt: now,
          messages: [userMessage, assistantMessage],
        };
        targetConversationId = newConv.id;
        setActiveId(newConv.id);
        setConversations((prev) => [newConv, ...prev]);
      } else {
        const current = conversationsRef.current.find((c) => c.id === targetConversationId);
        priorMessages = current?.messages ?? [];
        const isFirstUserMessage = priorMessages.length === 0;

        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== targetConversationId) return conv;
            return {
              ...conv,
              title: isFirstUserMessage ? deriveTitleFromMessage(promptText) : conv.title,
              updatedAt: now,
              messages: [...conv.messages, userMessage, assistantMessage],
            };
          })
        );
      }

      await runGeminiTurn({
        conversationId: targetConversationId,
        userPrompt: promptText,
        history: priorMessages,
        assistantMsgId: assistantMessage.id,
      });
    },
    [runGeminiTurn]
  );

  const handleRenameConversation = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === id ? { ...conv, title: trimmed, updatedAt: Date.now() } : conv
      )
    );
  }, []);

  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string, regenerateAfterSave: boolean) => {
      const currentActiveId = activeIdRef.current;
      const currentConv = conversationsRef.current.find((c) => c.id === currentActiveId);
      if (!currentConv || isGeneratingRef.current) return;

      const msgIndex = currentConv.messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      const targetMsg = currentConv.messages[msgIndex];
      const now = Date.now();

      if (!regenerateAfterSave || targetMsg.role !== 'user') {
        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== currentConv.id) return conv;
            return {
              ...conv,
              updatedAt: now,
              messages: conv.messages.map((m) =>
                m.id === messageId ? { ...m, content: newContent, updatedAt: now } : m
              ),
            };
          })
        );
        return;
      }

      const historyBefore = currentConv.messages.slice(0, msgIndex);
      const updatedUserMsg: ChatMessage = {
        ...targetMsg,
        content: newContent,
        updatedAt: now,
      };
      const newAssistantMsg: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        createdAt: now + 1,
      };

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentConv.id) return conv;
          return {
            ...conv,
            updatedAt: now,
            messages: [...historyBefore, updatedUserMsg, newAssistantMsg],
          };
        })
      );

      await runGeminiTurn({
        conversationId: currentConv.id,
        userPrompt: newContent,
        history: historyBefore,
        assistantMsgId: newAssistantMsg.id,
      });
    },
    [runGeminiTurn]
  );

  const handleRegenerateAssistant = useCallback(
    async (assistantMsgId: string) => {
      const currentActiveId = activeIdRef.current;
      const currentConv = conversationsRef.current.find((c) => c.id === currentActiveId);
      if (!currentConv || isGeneratingRef.current) return;

      const msgIndex = currentConv.messages.findIndex((m) => m.id === assistantMsgId);
      if (msgIndex === -1) return;

      let userIndex = -1;
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (currentConv.messages[i].role === 'user') {
          userIndex = i;
          break;
        }
      }
      if (userIndex === -1) return;

      const userMsg = currentConv.messages[userIndex];
      const historyBeforeUser = currentConv.messages.slice(0, userIndex);
      const now = Date.now();
      const freshAssistantMsg: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        createdAt: now,
      };

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentConv.id) return conv;
          return {
            ...conv,
            updatedAt: now,
            messages: [...currentConv.messages.slice(0, userIndex + 1), freshAssistantMsg],
          };
        })
      );

      await runGeminiTurn({
        conversationId: currentConv.id,
        userPrompt: userMsg.content,
        history: historyBeforeUser,
        assistantMsgId: freshAssistantMsg.id,
      });
    },
    [runGeminiTurn]
  );

  const handleDeleteMessage = useCallback((messageId: string) => {
    const currentActiveId = activeIdRef.current;
    if (!currentActiveId || isGeneratingRef.current) return;
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== currentActiveId) return conv;
        return {
          ...conv,
          updatedAt: Date.now(),
          messages: conv.messages.filter((m) => m.id !== messageId),
        };
      })
    );
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;

    if (deleteTarget.kind === 'all') {
      if (isGeneratingRef.current) {
        handleStopGenerating();
      }
      setConversations([]);
      setActiveId(null);
      setDeleteTarget(null);
      return;
    }

    const targetId = deleteTarget.conversation.id;
    if (streamingConvIdRef.current === targetId) {
      handleStopGenerating();
    }

    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== targetId);
      if (activeIdRef.current === targetId) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
    setDeleteTarget(null);
  }, [deleteTarget, handleStopGenerating]);

  const handleCloseMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (isGeneratingRef.current && streamingConvIdRef.current !== id) {
        handleStopGenerating();
      }
      setActiveId(id);
    },
    [handleStopGenerating]
  );

  const handleRequestDeleteConversation = useCallback((conversation: Conversation) => {
    setDeleteTarget({ kind: 'single', conversation });
  }, []);

  const handleRequestClearAll = useCallback(() => {
    setDeleteTarget({ kind: 'all' });
  }, []);

  const lastAssistantId = useMemo(() => {
    if (!activeConversation) return null;
    for (let i = activeConversation.messages.length - 1; i >= 0; i--) {
      if (activeConversation.messages[i].role === 'assistant') {
        return activeConversation.messages[i].id;
      }
    }
    return null;
  }, [activeConversation]);

  const isGenerating = streamingMsgId !== null;

  const commitHeaderRename = () => {
    if (activeConversation && headerDraftTitle.trim()) {
      handleRenameConversation(activeConversation.id, headerDraftTitle);
    }
    setIsHeaderRenaming(false);
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        isMobileOpen={isMobileSidebarOpen}
        isDesktopCollapsed={isDesktopSidebarCollapsed}
        onCloseMobile={handleCloseMobileSidebar}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onRequestDeleteConversation={handleRequestDeleteConversation}
        onRequestClearAll={handleRequestClearAll}
      />

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {/* Mobile Drawer Trigger */}
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Open conversation history"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Desktop Collapse Toggle */}
            <button
              type="button"
              onClick={() => setIsDesktopSidebarCollapsed((prev) => !prev)}
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:flex dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label={isDesktopSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              title={isDesktopSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {isDesktopSidebarCollapsed ? (
                <PanelLeftOpen className="h-4.5 w-4.5" />
              ) : (
                <PanelLeftClose className="h-4.5 w-4.5" />
              )}
            </button>

            {/* Active Conversation Title / Inline Rename */}
            {activeConversation ? (
              isHeaderRenaming ? (
                <div className="flex min-w-0 flex-1 max-w-md items-center gap-1.5 rounded-lg border border-blue-500 bg-slate-50 px-2.5 py-1 dark:bg-slate-900">
                  <input
                    ref={headerInputRef}
                    type="text"
                    value={headerDraftTitle}
                    onChange={(e) => setHeaderDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitHeaderRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setIsHeaderRenaming(false);
                      }
                    }}
                    aria-label="Rename active conversation"
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 focus:outline-none dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={commitHeaderRename}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950"
                    aria-label="Save conversation name"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsHeaderRenaming(false)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
                    aria-label="Cancel renaming"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate font-display text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
                    {activeConversation.title}
                  </h1>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderDraftTitle(activeConversation.title);
                      setIsHeaderRenaming(true);
                    }}
                    className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:flex dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Rename current conversation"
                    title="Rename conversation"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <span className="hidden text-xs text-slate-400 tabular-nums md:inline dark:text-slate-500">
                    <span aria-hidden="true">·</span>{' '}
                    {activeConversation.messages.length}{' '}
                    {activeConversation.messages.length === 1 ? 'message' : 'messages'}
                  </span>
                </div>
              )
            ) : (
              <h1 className="font-display text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100 whitespace-nowrap">
                New Conversation
              </h1>
            )}
          </div>

          {/* Right Header Controls */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleNewChat}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Start new chat"
              title="New Chat"
            >
              <SquarePen className="h-4.5 w-4.5" />
            </button>

            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              title={theme === 'light' ? 'Dark mode' : 'Light mode'}
            >
              {theme === 'light' ? (
                <Moon className="h-4.5 w-4.5" />
              ) : (
                <Sun className="h-4.5 w-4.5" />
              )}
            </button>
          </div>
        </header>

        {/* Storage Quota Warning Banner */}
        {storageError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 sm:px-6 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{storageError}</span>
            </div>
            <button
              type="button"
              onClick={() => setStorageError(null)}
              className="rounded p-1 hover:bg-amber-200/60 dark:hover:bg-amber-900/60"
              aria-label="Dismiss storage warning"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Chat Viewport */}
        <main className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
          >
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-6 w-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" />
                  </svg>
                </div>

                <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white text-balance">
                  How can I help you today?
                </h2>
                <p className="mt-2.5 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Ask questions, write or debug code, translate languages, or brainstorm ideas. Your
                  conversations stay saved in this browser.
                </p>

                <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => handleSendMessage(item.prompt)}
                      disabled={isGenerating}
                      className="group rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-left transition-colors hover:border-blue-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-blue-700 dark:hover:bg-slate-900"
                    >
                      <div className="text-sm font-medium text-slate-900 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                        {item.title}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {item.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 pb-4">
                {activeConversation.messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    isStreaming={streamingMsgId === msg.id}
                    isLastAssistant={msg.id === lastAssistantId}
                    disabled={isGenerating}
                    onEditMessage={handleEditMessage}
                    onDeleteMessage={handleDeleteMessage}
                    onRegenerate={handleRegenerateAssistant}
                  />
                ))}
                <div ref={messagesEndRef} className="h-1" />
              </div>
            )}
          </div>

          {/* Scroll-to-latest button */}
          {showScrollButton && (
            <button
              type="button"
              onClick={() => {
                shouldAutoScrollRef.current = true;
                scrollToBottom('smooth');
                setShowScrollButton(false);
              }}
              className="absolute right-6 bottom-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              aria-label="Scroll to latest message"
              title="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </main>

        {/* Composer */}
        <Composer
          resetKey={`${activeId ?? 'new'}-${composerResetNonce}`}
          isGenerating={isGenerating}
          onSend={handleSendMessage}
          onStop={handleStopGenerating}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        title={
          deleteTarget?.kind === 'all'
            ? 'Clear all chat history?'
            : 'Delete conversation?'
        }
        description={
          deleteTarget?.kind === 'all'
            ? `This will permanently remove all ${conversations.length} saved conversations from your browser storage. This action cannot be undone.`
            : deleteTarget?.kind === 'single'
              ? `This will permanently delete "${deleteTarget.conversation.title}" (${deleteTarget.conversation.messages.length} ${
                  deleteTarget.conversation.messages.length === 1 ? 'message' : 'messages'
                }) from your browser storage.`
              : ''
        }
        confirmLabel={deleteTarget?.kind === 'all' ? 'Clear All' : 'Delete'}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
