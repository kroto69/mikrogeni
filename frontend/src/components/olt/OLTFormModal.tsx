import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOLTDevice, getApiErrorMessage } from "@/lib/api";
import { showToast } from "@/lib/toast";

type OLTFormModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type FormState = {
  id: string;
  endpoint: string;
};

const defaultState: FormState = {
  id: "",
  endpoint: "",
};

export default function OLTFormModal({ open, onClose, onCreated }: OLTFormModalProps) {
  const [form, setForm] = useState<FormState>(defaultState);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(defaultState);
  }, [open]);

  const createMutation = useMutation({
    mutationFn: createOLTDevice,
    onSuccess: () => {
      showToast({ title: "OLT berhasil ditambahkan", variant: "success" });
      onCreated();
      onClose();
    },
    onError: (error) => {
      showToast({
        title: "Gagal menambahkan OLT",
        description: getApiErrorMessage(error),
        variant: "error",
      });
    },
  });

  const validationMessage = useMemo(() => {
    if (!form.id.trim()) {
      return "OLT ID wajib diisi";
    }
    if (form.id.trim().length !== 8) {
      return "OLT ID harus 8 karakter";
    }
    if (!form.endpoint.trim()) {
      return "Endpoint wajib diisi";
    }

    return "";
  }, [form.endpoint, form.id]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-foreground/45 p-3 sm:p-6">
      <button aria-label="Close form" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 w-full max-w-2xl rounded-[28px] border-2 border-border bg-card text-card-foreground shadow-brutal-lg">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b-2 border-border bg-card px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Add OLT (Manual)</h3>
            <p className="mt-1 text-sm text-muted-foreground">Masukkan OLT ID dan endpoint. Deploy backend OLT service dilakukan manual di sisi kamu.</p>
          </div>
          <Button className="h-8 w-8 p-0" onClick={onClose} type="button" variant="outline">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Button>
        </div>

        <form
          className="space-y-5 px-5 py-5 sm:px-6"
          onSubmit={(event) => {
            event.preventDefault();

            if (validationMessage) {
              showToast({ title: validationMessage, variant: "error" });
              return;
            }

            createMutation.mutate({
              id: form.id.trim(),
              endpoint: form.endpoint.trim(),
            });
          }}
        >
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Manual OLT Onboarding</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground" htmlFor="olt-id">OLT ID *</label>
                <Input
                  id="olt-id"
                  maxLength={8}
                  onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
                  placeholder="contoh: c320a001"
                  value={form.id}
                />
                <p className="text-xs text-muted-foreground">Gunakan ID unik 8 karakter. ID ini dipakai sebagai identitas OLT di sistem.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground" htmlFor="olt-endpoint">Endpoint *</label>
                <Input
                  id="olt-endpoint"
                  onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))}
                  placeholder="http://10.0.0.5:8081"
                  value={form.endpoint}
                />
                <p className="text-xs text-muted-foreground">Endpoint harus sudah aktif dan bisa diakses oleh backend.</p>
              </div>
            </div>
          </section>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button onClick={onClose} type="button" variant="outline">Cancel</Button>
            <Button disabled={createMutation.isPending} type="submit">
              {createMutation.isPending ? "Saving..." : "Save OLT"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
