"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// UI foundation — Toast.
//
// A minimal toast surface: one provider, one live region, one call.
// The region is polite (aria-live="polite") so a toast never interrupts
// what a screen reader is saying, and it is rendered once, at the end
// of the document, so the message is announced wherever the user is.
//
// The tone vocabulary is deliberately small. A toast is a confirmation
// of an action the user just took — it is not a money or attendance
// state, so it never wears the good/late/warn colours (DESIGN.md §1.1).

export type ToastInput = {
  title: string;
  description?: string;
};

export type ToastMessage = ToastInput & { id: string };

type ToastContextValue = {
  toast: (message: ToastInput) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const toast = useCallback((message: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((current) => [...current, { id, ...message }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[var(--z-toast)] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className="pointer-events-auto max-w-sm rounded-ctl border border-line bg-paper px-4 py-3 text-[13px] text-ink shadow-2"
          >
            <p className="font-medium">{message.title}</p>
            {message.description ? (
              <p className="mt-0.5 text-ink-2">{message.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return value;
}
