export type ToastVariant = "default" | "success" | "error";

export type ToastMessage = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

export const TOAST_EVENT = "network-core:toast";

export function showToast(message: ToastMessage) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}
