import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastMessage, type ToastVariant } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ToastItem = ToastMessage & {
  id: number;
};

const variantClasses: Record<ToastVariant, string> = {
  default: "border-slate-200 bg-white text-slate-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
};

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 1;

    const handleToast = (event: Event) => {
      const customEvent = event as CustomEvent<ToastMessage>;
      const toast: ToastItem = {
        id: nextId++,
        duration: 3500,
        variant: "default",
        ...customEvent.detail,
      };

      setToasts((current) => [...current, toast]);

      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, toast.duration);
    };

    window.addEventListener(TOAST_EVENT, handleToast as EventListener);

    return () => {
      window.removeEventListener(TOAST_EVENT, handleToast as EventListener);
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[120] flex flex-col items-center gap-3 px-3 sm:items-end sm:px-4">
      {toasts.map((toast) => (
        <div
          className={cn(
            "pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-3 shadow-xl backdrop-blur",
            variantClasses[toast.variant ?? "default"],
          )}
          key={toast.id}
          role="status"
        >
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.description ? <p className="mt-1 text-xs opacity-80">{toast.description}</p> : null}
        </div>
      ))}
    </div>
  );
}
