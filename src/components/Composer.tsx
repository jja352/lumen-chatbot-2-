import { memo, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface ComposerProps {
  resetKey: string;
  isGenerating: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
}

export const Composer = memo(function Composer({
  resetKey,
  isGenerating,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue('');
  }, [resetKey]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !isGenerating;

  const submitDraft = () => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) return;
    setValue('');
    onSend(trimmed);
  };

  return (
    <div className="border-t border-slate-200 bg-white/95 px-4 pt-3 pb-4 backdrop-blur-xs sm:px-6 dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 transition-colors focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/15 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-blue-500 dark:focus-within:bg-slate-900">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) {
                  submitDraft();
                }
              }
            }}
            placeholder="Message Lumen Chat..."
            rows={1}
            aria-label="Chat message input"
            className="max-h-[180px] min-h-[42px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
          />

          {isGenerating ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submitDraft}
              disabled={!canSend}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
              aria-label="Send message"
              title="Send message"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
          Press Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
});
