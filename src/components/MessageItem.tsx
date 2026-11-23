import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { formatTimestamp } from '../utils/storage';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MessageItemProps {
  message: ChatMessage;
  isStreaming: boolean;
  isLastAssistant: boolean;
  disabled: boolean;
  onEditMessage: (id: string, newContent: string, regenerateAfterSave: boolean) => void;
  onDeleteMessage: (id: string) => void;
  onRegenerate: (messageId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  isStreaming,
  isLastAssistant,
  disabled,
  onEditMessage,
  onDeleteMessage,
  onRegenerate,
}: MessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 260)}px`;
    }
  }, [isEditing]);

  const handleCopy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleStartEdit = () => {
    setDraftContent(message.content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftContent(message.content);
    setIsEditing(false);
  };

  const handleSaveEdit = (regenerateAfterSave: boolean) => {
    const trimmed = draftContent.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEditMessage(message.id, trimmed, regenerateAfterSave);
  };

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex flex-col items-end">
        <div className="w-full max-w-[85%] sm:max-w-[75%]">
          {isEditing ? (
            <div className="rounded-2xl border border-blue-500 bg-white p-3.5 shadow-xs dark:bg-slate-900">
              <textarea
                ref={textareaRef}
                value={draftContent}
                onChange={(e) => {
                  setDraftContent(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 260)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelEdit();
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveEdit(true);
                  }
                }}
                rows={2}
                aria-label="Edit user message"
                className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-900 focus:outline-none dark:text-slate-100"
              />
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEdit(false)}
                  disabled={!draftContent.trim()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEdit(true)}
                  disabled={!draftContent.trim() || disabled}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Save &amp; Regenerate</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-end">
              <div className="rounded-2xl rounded-br-sm border border-slate-200/80 bg-slate-100 px-4 py-3 text-[15px] leading-[1.6] text-slate-900 whitespace-pre-wrap break-words dark:border-slate-700/70 dark:bg-slate-800 dark:text-slate-100">
                {message.content}
              </div>

              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400 tabular-nums dark:text-slate-500">
                <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Copy message"
                    title="Copy"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    disabled={disabled}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Edit message"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteMessage(message.id)}
                    disabled={disabled}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/60 dark:hover:text-red-400"
                    aria-label="Delete message"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span>{formatTimestamp(message.createdAt)}</span>
                {message.updatedAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Edited</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="group flex items-start gap-3.5">
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          message.isError
            ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-400'
            : 'border-slate-200 bg-white text-blue-600 dark:border-slate-800 dark:bg-slate-900 dark:text-blue-400'
        }`}
        aria-hidden="true"
      >
        {message.isError ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-4 w-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" />
          </svg>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="rounded-2xl border border-blue-500 bg-white p-3.5 shadow-xs dark:bg-slate-900">
            <textarea
              ref={textareaRef}
              value={draftContent}
              onChange={(e) => {
                setDraftContent(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 260)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSaveEdit(false);
                }
              }}
              rows={3}
              aria-label="Edit assistant message"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-900 focus:outline-none dark:text-slate-100"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                onClick={() => handleSaveEdit(false)}
                disabled={!draftContent.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Save</span>
              </button>
            </div>
          </div>
        ) : message.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-200">
            <p className="font-medium">Could not generate response</p>
            <p className="mt-1 text-red-700 dark:text-red-300">{message.content}</p>
            <div className="mt-3 flex items-center gap-2">
              {message.retryable !== false && (
                <button
                  type="button"
                  onClick={() => onRegenerate(message.id)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDeleteMessage(message.id)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            {isStreaming && message.content.length === 0 ? (
              <div
                className="flex items-center gap-2 py-2 text-sm text-slate-500 dark:text-slate-400"
                role="status"
                aria-label="Gemini is generating a response"
              >
                <div className="flex items-center gap-1">
                  <span className="typing-dot h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                  <span className="typing-dot h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                </div>
                <span>Thinking…</span>
              </div>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}

            {!isStreaming && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400 tabular-nums dark:text-slate-500">
                <span>{formatTimestamp(message.createdAt)}</span>
                {message.updatedAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Edited</span>
                  </>
                )}
                <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Copy response"
                    title="Copy"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    disabled={disabled}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Edit response"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {isLastAssistant && (
                    <button
                      type="button"
                      onClick={() => onRegenerate(message.id)}
                      disabled={disabled}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      aria-label="Regenerate response"
                      title="Regenerate"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteMessage(message.id)}
                    disabled={disabled}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/60 dark:hover:text-red-400"
                    aria-label="Delete response"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
