import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/retroui/Select";
import { PageSectionHeader } from "@/components/page/section-header";
import {
  createBillingCustomer,
  createBillingPayment,
  createBillingServicePlan,
  getApiErrorMessage,
  getBillingCustomers,
  getBillingInvoices,
  getBillingPayments,
  getBillingServicePlans,
  getMikrotikDevices,
  runOverdueCheckerNow,
  runRecurringBillingNow,
} from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { BillingCustomerStatus, BillingInvoice, BillingInvoiceStatus } from "@/types/billing";

type NewPlanForm = {
  code: string;
  name: string;
  price: string;
  billingCycleDays: string;
  mikrotikProfile: string;
};

type NewCustomerForm = {
  customerCode: string;
  fullName: string;
  phone: string;
  address: string;
  mikrotikDeviceId: string;
  pppSecretName: string;
  servicePlanId: string;
  nextBillingAt: string;
};

type ImportedCustomerRow = {
  lineNo: number;
  name: string;
  address: string;
  phone: string;
  pppoe: string;
  packageName: string;
  customerCode?: string;
  nextBillingAt?: string;
  mikrotikHint?: string;
};

const EMPTY_PLAN_FORM: NewPlanForm = {
  code: "",
  name: "",
  price: "",
  billingCycleDays: "30",
  mikrotikProfile: "",
};

const EMPTY_CUSTOMER_FORM: NewCustomerForm = {
  customerCode: "",
  fullName: "",
  phone: "",
  address: "",
  mikrotikDeviceId: "",
  pppSecretName: "",
  servicePlanId: "",
  nextBillingAt: "",
};

function toRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function getInvoiceVariant(status: BillingInvoiceStatus): "default" | "secondary" | "warning" | "success" {
  if (status === "paid") return "success";
  if (status === "overdue") return "warning";
  if (status === "partial") return "secondary";
  return "default";
}

function getCustomerVariant(status: BillingCustomerStatus): "success" | "warning" | "destructive" {
  if (status === "active") return "success";
  if (status === "overdue") return "warning";
  return "destructive";
}

function splitImportLine(line: string): string[] {
  const delimiter = line.includes("|") ? "|" : line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
  return line.split(delimiter).map((part) => part.trim());
}

function normalizeColumnName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function detectHeader(cells: string[]) {
  if (cells.length < 5) {
    return false;
  }

  const keys = cells.map(normalizeColumnName);
  const hasName = keys.some((key) => key === "name" || key === "nama");
  const hasAddress = keys.some((key) => key.includes("alamat") || key.includes("address"));
  const hasPhone = keys.some((key) => key.includes("nomorhp") || key.includes("nohp") || key.includes("phone"));
  const hasPppoe = keys.some((key) => key.includes("pppoe") || key.includes("secret"));
  const hasPackage = keys.some((key) => key.includes("paket") || key.includes("package") || key.includes("plan"));

  return hasName && hasAddress && hasPhone && hasPppoe && hasPackage;
}

function getCell(cells: string[], index: number) {
  if (index < 0 || index >= cells.length) {
    return "";
  }
  return cells[index]?.trim() ?? "";
}

function findHeaderIndex(keys: string[], matchers: ((value: string) => boolean)[]) {
  return keys.findIndex((key) => matchers.some((matcher) => matcher(key)));
}

function parseImportText(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) {
    return {
      rows: [] as ImportedCustomerRow[],
      errors: [] as string[],
    };
  }

  const rows: ImportedCustomerRow[] = [];
  const errors: string[] = [];

  const firstCells = splitImportLine(lines[0]);
  const hasHeader = detectHeader(firstCells);
  const startIndex = hasHeader ? 1 : 0;

  let indexes = {
    name: 0,
    address: 1,
    phone: 2,
    pppoe: 3,
    packageName: 4,
    customerCode: 5,
    nextBillingAt: 6,
    mikrotikHint: 7,
  };

  if (hasHeader) {
    const keys = firstCells.map(normalizeColumnName);
    indexes = {
      name: findHeaderIndex(keys, [(key) => key === "name", (key) => key === "nama"]),
      address: findHeaderIndex(keys, [(key) => key.includes("alamat"), (key) => key.includes("address")]),
      phone: findHeaderIndex(keys, [(key) => key.includes("nomorhp"), (key) => key.includes("nohp"), (key) => key.includes("phone"), (key) => key === "hp"]),
      pppoe: findHeaderIndex(keys, [(key) => key.includes("pppoe"), (key) => key.includes("pppsecret"), (key) => key === "secret"]),
      packageName: findHeaderIndex(keys, [(key) => key.includes("paket"), (key) => key.includes("package"), (key) => key.includes("plan")]),
      customerCode: findHeaderIndex(keys, [(key) => key.includes("customercode"), (key) => key === "kodecustomer", (key) => key === "code"]),
      nextBillingAt: findHeaderIndex(keys, [(key) => key.includes("nextbillingat"), (key) => key.includes("nextbilling"), (key) => key.includes("billingdate")]),
      mikrotikHint: findHeaderIndex(keys, [(key) => key.includes("mikrotik"), (key) => key.includes("router"), (key) => key.includes("device")]),
    };
  }

  for (let index = startIndex; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const cells = splitImportLine(lines[index]);

    if (cells.length < 5) {
      errors.push(`Baris ${lineNo}: minimal 5 kolom (NAME|ALAMAT|NOMOR HP|PPPOE|PAKET).`);
      continue;
    }

    const name = getCell(cells, indexes.name);
    const address = getCell(cells, indexes.address);
    const phone = getCell(cells, indexes.phone);
    const pppoe = getCell(cells, indexes.pppoe);
    const packageName = getCell(cells, indexes.packageName);
    const customerCode = getCell(cells, indexes.customerCode) || undefined;
    const nextBillingAt = getCell(cells, indexes.nextBillingAt) || undefined;
    const mikrotikHint = getCell(cells, indexes.mikrotikHint) || undefined;

    if (!name || !pppoe || !packageName) {
      errors.push(`Baris ${lineNo}: NAME, PPPOE, dan PAKET wajib diisi.`);
      continue;
    }

    rows.push({
      lineNo,
      name,
      address,
      phone,
      pppoe,
      packageName,
      customerCode,
      nextBillingAt,
      mikrotikHint,
    });
  }

  return { rows, errors };
}

function sanitizeCustomerCode(raw: string) {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "");
}

function buildGeneratedCustomerCode(prefix: string, batchCode: string, sequence: number) {
  const normalizedPrefix = sanitizeCustomerCode(prefix || "CUST") || "CUST";
  return `${normalizedPrefix}-${batchCode}-${String(sequence).padStart(4, "0")}`;
}

export default function BillingIndex() {
  const queryClient = useQueryClient();
  const [planForm, setPlanForm] = useState<NewPlanForm>(EMPTY_PLAN_FORM);
  const [customerForm, setCustomerForm] = useState<NewCustomerForm>(EMPTY_CUSTOMER_FORM);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<number, string>>({});
  const [customerSearch, setCustomerSearch] = useState("");
  const [importRawText, setImportRawText] = useState("");
  const [importMikrotikDeviceId, setImportMikrotikDeviceId] = useState("");
  const [importCustomerCodePrefix, setImportCustomerCodePrefix] = useState("CUST");

  const plansQuery = useQuery({
    queryKey: ["billing-service-plans"],
    queryFn: () => getBillingServicePlans(),
  });

  const customersQuery = useQuery({
    queryKey: ["billing-customers"],
    queryFn: () => getBillingCustomers(),
  });

  const invoicesQuery = useQuery({
    queryKey: ["billing-invoices"],
    queryFn: () => getBillingInvoices(),
  });

  const paymentsQuery = useQuery({
    queryKey: ["billing-payments"],
    queryFn: () => getBillingPayments(),
  });

  const mikrotikDevicesQuery = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
  });

  const createPlanMutation = useMutation({
    mutationFn: createBillingServicePlan,
    onSuccess: async () => {
      showToast({
        title: "Service plan dibuat",
        description: "Plan billing berhasil ditambahkan.",
        variant: "success",
      });
      setPlanForm(EMPTY_PLAN_FORM);
      await queryClient.invalidateQueries({ queryKey: ["billing-service-plans"] });
    },
    onError: (error) => {
      showToast({ title: "Gagal buat service plan", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: createBillingCustomer,
    onSuccess: async () => {
      showToast({
        title: "Customer billing dibuat",
        description: "Customer berhasil terdaftar untuk siklus billing.",
        variant: "success",
      });
      setCustomerForm(EMPTY_CUSTOMER_FORM);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billing-customers"] }),
        queryClient.invalidateQueries({ queryKey: ["billing-invoices"] }),
      ]);
    },
    onError: (error) => {
      showToast({ title: "Gagal buat customer", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const runRecurringMutation = useMutation({
    mutationFn: runRecurringBillingNow,
    onSuccess: async (result) => {
      showToast({
        title: "Recurring billing dieksekusi",
        description: `Generated ${result.generated}, skipped ${result.skipped}.`,
        variant: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billing-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["billing-customers"] }),
      ]);
    },
    onError: (error) => {
      showToast({ title: "Recurring billing gagal", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const runOverdueMutation = useMutation({
    mutationFn: runOverdueCheckerNow,
    onSuccess: async (result) => {
      showToast({
        title: "Overdue checker dieksekusi",
        description: `Overdue ${result.marked_overdue}, suspended ${result.suspended}.`,
        variant: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billing-customers"] }),
        queryClient.invalidateQueries({ queryKey: ["billing-invoices"] }),
      ]);
    },
    onError: (error) => {
      showToast({ title: "Overdue checker gagal", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: ({ invoiceId, amount }: { invoiceId: number; amount: number }) =>
      createBillingPayment(invoiceId, {
        amount,
        method: "cash",
      }),
    onSuccess: async (result) => {
      showToast({
        title: "Pembayaran tercatat",
        description: result.warning || `Status invoice: ${result.invoice.status}`,
        variant: result.warning ? "default" : "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billing-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["billing-payments"] }),
        queryClient.invalidateQueries({ queryKey: ["billing-customers"] }),
      ]);
    },
    onError: (error) => {
      showToast({ title: "Pembayaran gagal", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const plans = plansQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const mikrotikDevices = mikrotikDevicesQuery.data ?? [];

  const importPreview = useMemo(() => parseImportText(importRawText), [importRawText]);

  const servicePlanLookup = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const plan of plans) {
      const code = plan.code.trim().toLowerCase();
      const name = plan.name.trim().toLowerCase();
      if (code) {
        byKey.set(code, plan.id);
      }
      if (name) {
        byKey.set(name, plan.id);
      }
    }
    return byKey;
  }, [plans]);

  const mikrotikLookup = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const device of mikrotikDevices) {
      const id = String(device.id ?? "").trim();
      const name = String(device.name ?? "").trim().toLowerCase();
      const host = String(device.host ?? "").trim().toLowerCase();

      if (id) {
        byKey.set(id.toLowerCase(), id);
      }
      if (name) {
        byKey.set(name, id);
      }
      if (host) {
        byKey.set(host, id);
      }
      if (name && host) {
        byKey.set(`${name}(${host})`, id);
        byKey.set(`${name} (${host})`, id);
      }
    }
    return byKey;
  }, [mikrotikDevices]);

  const importCustomersMutation = useMutation({
    mutationFn: async () => {
      if (importPreview.rows.length === 0) {
        throw new Error("Data import kosong atau belum valid.");
      }

      const errors = [...importPreview.errors];
      let successCount = 0;
      let failedCount = 0;
      const batchCode = String(Date.now()).slice(-6);

      for (let index = 0; index < importPreview.rows.length; index += 1) {
        const row = importPreview.rows[index];
        const packageKey = row.packageName.trim().toLowerCase();
        const servicePlanId = servicePlanLookup.get(packageKey);

        if (!servicePlanId) {
          failedCount += 1;
          errors.push(`Baris ${row.lineNo}: paket '${row.packageName}' tidak ditemukan di Service Plan.`);
          continue;
        }

        const customerCode = row.customerCode
          ? sanitizeCustomerCode(row.customerCode)
          : buildGeneratedCustomerCode(importCustomerCodePrefix, batchCode, index + 1);

        if (!customerCode) {
          failedCount += 1;
          errors.push(`Baris ${row.lineNo}: customer code tidak valid.`);
          continue;
        }

        const rowMikrotikHint = row.mikrotikHint?.trim() ?? "";
        const normalizedHint = rowMikrotikHint.toLowerCase();
        const defaultMikrotikDevice = importMikrotikDeviceId.trim();

        let resolvedMikrotikDeviceId = "";
        if (normalizedHint) {
          resolvedMikrotikDeviceId = mikrotikLookup.get(normalizedHint) ?? "";
          if (!resolvedMikrotikDeviceId) {
            failedCount += 1;
            errors.push(
              `Baris ${row.lineNo}: MikroTik '${rowMikrotikHint}' tidak dikenali (pakai id/name/host yang valid).`,
            );
            continue;
          }
        } else if (defaultMikrotikDevice) {
          resolvedMikrotikDeviceId = defaultMikrotikDevice;
        } else {
          failedCount += 1;
          errors.push(
            `Baris ${row.lineNo}: isi kolom MIKROTIK atau pilih default MikroTik device.`,
          );
          continue;
        }

        try {
          await createBillingCustomer({
            customer_code: customerCode,
            full_name: row.name,
            phone: row.phone,
            address: row.address,
            mikrotik_device_id: resolvedMikrotikDeviceId,
            ppp_secret_name: row.pppoe,
            service_plan_id: servicePlanId,
            next_billing_at: row.nextBillingAt,
          });
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          errors.push(`Baris ${row.lineNo}: ${getApiErrorMessage(error)}`);
        }
      }

      return {
        successCount,
        failedCount,
        errors,
      };
    },
    onSuccess: async (result) => {
      if (result.successCount > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["billing-customers"] }),
          queryClient.invalidateQueries({ queryKey: ["billing-invoices"] }),
        ]);
      }

      if (result.failedCount === 0) {
        showToast({
          title: "Import berhasil",
          description: `${result.successCount} pelanggan berhasil diimport.`,
          variant: "success",
        });
        setImportRawText("");
      } else {
        showToast({
          title: "Import selesai dengan catatan",
          description: `Sukses ${result.successCount}, gagal ${result.failedCount}. Lihat detail error di panel import.`,
          variant: "default",
        });
      }
    },
    onError: (error) => {
      showToast({
        title: "Import gagal dijalankan",
        description: getApiErrorMessage(error),
        variant: "error",
      });
    },
  });

  const summary = useMemo(() => {
    return {
      plans: plans.length,
      customers: customers.length,
      suspended: customers.filter((item) => item.status === "suspended").length,
      unpaidOrOverdue: invoices.filter((item) => item.status !== "paid").length,
      billingAmount: invoices.reduce((acc, item) => acc + item.amount, 0),
    };
  }, [plans, customers, invoices]);

  const pendingInvoiceRows = useMemo(
    () => invoices.filter((invoice) => invoice.status !== "paid").slice(0, 15),
    [invoices],
  );

  const recentPayments = useMemo(() => payments.slice(0, 10), [payments]);

  const filteredCustomers = useMemo(() => {
    const keyword = customerSearch.trim().toLowerCase();
    if (!keyword) {
      return customers;
    }

    return customers.filter((customer) => {
      const searchable = [
        customer.full_name,
        customer.customer_code,
        customer.phone,
        customer.address,
        customer.ppp_secret_name,
        customer.service_plan_code,
        customer.service_plan_name,
        customer.status,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(keyword);
    });
  }, [customers, customerSearch]);

  const isLoadingAny =
    plansQuery.isLoading ||
    customersQuery.isLoading ||
    invoicesQuery.isLoading ||
    mikrotikDevicesQuery.isLoading ||
    paymentsQuery.isLoading;

  const importRuntimeErrors = importCustomersMutation.data?.errors ?? [];

  return (
    <div className="route-shell-page route-shell-billing space-y-4 sm:space-y-5">
      <section className="route-shell-panel relative overflow-hidden rounded-[26px] border-2 border-border bg-primary/20 shadow-[12px_12px_0_0_hsl(var(--border))]">
        <div className="pointer-events-none absolute -right-8 top-4 h-24 w-24 rotate-[15deg] border-2 border-border bg-accent/70" />
        <div className="pointer-events-none absolute bottom-3 left-5 h-4 w-20 -rotate-6 border-2 border-border bg-secondary/80" />
        <div className="flex flex-col gap-3 p-3.5 sm:p-4">
          <PageSectionHeader
            title={<h2 className="font-display text-xl font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">Billing RT/RW Net</h2>}
            description={<p className="text-[13px] font-semibold text-muted-foreground">Lifecycle billing: active → invoice → overdue → suspended → paid → active.</p>}
            meta={<span className="inline-flex rounded-full border-2 border-border bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">Backend integrated</span>}
            actions={(
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={runRecurringMutation.isPending}
                  onClick={() => runRecurringMutation.mutate()}
                  type="button"
                  variant="secondary"
                >
                  Run Recurring
                </Button>
                <Button
                  disabled={runOverdueMutation.isPending}
                  onClick={() => runOverdueMutation.mutate()}
                  type="button"
                  variant="outline"
                >
                  Run Overdue Checker
                </Button>
              </div>
            )}
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-[16px] border-2 border-border bg-card px-3 py-2 shadow-brutal-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Service Plans</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{summary.plans}</p>
            </div>
            <div className="rounded-[16px] border-2 border-border bg-card px-3 py-2 shadow-brutal-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Customers</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{summary.customers}</p>
            </div>
            <div className="rounded-[16px] border-2 border-border bg-card px-3 py-2 shadow-brutal-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Suspended</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{summary.suspended}</p>
            </div>
            <div className="rounded-[16px] border-2 border-border bg-card px-3 py-2 shadow-brutal-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Open Invoices</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{summary.unpaidOrOverdue}</p>
            </div>
            <div className="rounded-[16px] border-2 border-border bg-card px-3 py-2 shadow-brutal-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Gross Billing</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{toRupiah(summary.billingAmount)}</p>
            </div>
          </div>
        </div>
      </section>

      {isLoadingAny ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Memuat data billing...</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Service Plan</CardTitle>
            <CardDescription>Plan paket internet untuk recurring invoice.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createPlanMutation.mutate({
                  code: planForm.code.trim(),
                  name: planForm.name.trim(),
                  price: Number.parseInt(planForm.price, 10),
                  billing_cycle_days: Number.parseInt(planForm.billingCycleDays, 10) || 30,
                  mikrotik_profile: planForm.mikrotikProfile.trim(),
                });
              }}
            >
              <Input placeholder="Code (HOME20)" required value={planForm.code} onChange={(event) => setPlanForm((prev) => ({ ...prev, code: event.target.value }))} />
              <Input placeholder="Name" required value={planForm.name} onChange={(event) => setPlanForm((prev) => ({ ...prev, name: event.target.value }))} />
              <Input placeholder="Price (IDR)" required type="number" value={planForm.price} onChange={(event) => setPlanForm((prev) => ({ ...prev, price: event.target.value }))} />
              <Input placeholder="Cycle days" type="number" value={planForm.billingCycleDays} onChange={(event) => setPlanForm((prev) => ({ ...prev, billingCycleDays: event.target.value }))} />
              <Input className="sm:col-span-2" placeholder="MikroTik profile (optional)" value={planForm.mikrotikProfile} onChange={(event) => setPlanForm((prev) => ({ ...prev, mikrotikProfile: event.target.value }))} />
              <div className="sm:col-span-2">
                <Button disabled={createPlanMutation.isPending} type="submit">Save Service Plan</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Billing Customer</CardTitle>
            <CardDescription>Daftarkan pelanggan ke lifecycle billing + device PPP secret.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!customerForm.servicePlanId || !customerForm.mikrotikDeviceId) {
                  showToast({
                    title: "Lengkapi field wajib",
                    description: "Pilih service plan dan perangkat MikroTik terlebih dahulu.",
                    variant: "error",
                  });
                  return;
                }
                createCustomerMutation.mutate({
                  customer_code: customerForm.customerCode.trim(),
                  full_name: customerForm.fullName.trim(),
                  phone: customerForm.phone.trim(),
                  address: customerForm.address.trim(),
                  mikrotik_device_id: customerForm.mikrotikDeviceId,
                  ppp_secret_name: customerForm.pppSecretName.trim(),
                  service_plan_id: Number.parseInt(customerForm.servicePlanId, 10),
                  next_billing_at: customerForm.nextBillingAt.trim() || undefined,
                });
              }}
            >
              <Input placeholder="Customer code" required value={customerForm.customerCode} onChange={(event) => setCustomerForm((prev) => ({ ...prev, customerCode: event.target.value }))} />
              <Input placeholder="Full name" required value={customerForm.fullName} onChange={(event) => setCustomerForm((prev) => ({ ...prev, fullName: event.target.value }))} />
              <Input placeholder="Phone" value={customerForm.phone} onChange={(event) => setCustomerForm((prev) => ({ ...prev, phone: event.target.value }))} />
              <Input placeholder="PPP secret name" required value={customerForm.pppSecretName} onChange={(event) => setCustomerForm((prev) => ({ ...prev, pppSecretName: event.target.value }))} />

              <Select
                value={customerForm.servicePlanId || undefined}
                onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, servicePlanId: value }))}
              >
                <Select.Trigger className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
                  <Select.Value placeholder="Select service plan" />
                </Select.Trigger>
                <Select.Content>
                  {plans.map((plan) => (
                    <Select.Item key={plan.id} value={String(plan.id)}>
                      {plan.code} - {plan.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>

              <Select
                value={customerForm.mikrotikDeviceId || undefined}
                onValueChange={(value) => setCustomerForm((prev) => ({ ...prev, mikrotikDeviceId: value }))}
              >
                <Select.Trigger className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
                  <Select.Value placeholder="Select MikroTik device" />
                </Select.Trigger>
                <Select.Content>
                  {mikrotikDevices.map((device) => (
                    <Select.Item key={device.id} value={String(device.id)}>
                      {device.name} ({device.host})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>

              {!customerForm.servicePlanId || !customerForm.mikrotikDeviceId ? (
                <p className="sm:col-span-2 text-xs font-semibold text-destructive">
                  Service plan dan perangkat MikroTik wajib dipilih.
                </p>
              ) : null}

              <Input className="sm:col-span-2" placeholder="Address" value={customerForm.address} onChange={(event) => setCustomerForm((prev) => ({ ...prev, address: event.target.value }))} />
              <Input className="sm:col-span-2" placeholder="Next billing at (RFC3339 or YYYY-MM-DD, optional)" value={customerForm.nextBillingAt} onChange={(event) => setCustomerForm((prev) => ({ ...prev, nextBillingAt: event.target.value }))} />

              <div className="sm:col-span-2">
                <Button disabled={createCustomerMutation.isPending || !customerForm.servicePlanId || !customerForm.mikrotikDeviceId} type="submit">Save Billing Customer</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Import Pelanggan dari Data Luar</CardTitle>
          <CardDescription>
            Format minimal: <span className="font-semibold">NAME | ALAMAT | NOMOR HP | PPPOE | PAKET</span>.
            Kolom tambahan opsional: <span className="font-semibold">CUSTOMER_CODE | NEXT_BILLING_AT | MIKROTIK</span>.
            Isi <span className="font-semibold">MIKROTIK</span> dengan <span className="font-semibold">id / name / host</span> untuk auto multi MikroTik per baris.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              value={importMikrotikDeviceId || undefined}
              onValueChange={(value) => setImportMikrotikDeviceId(value)}
            >
              <Select.Trigger className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
                <Select.Value placeholder="Default MikroTik device (opsional, untuk fallback)" />
              </Select.Trigger>
              <Select.Content>
                {mikrotikDevices.map((device) => (
                  <Select.Item key={device.id} value={String(device.id)}>
                    {device.name} ({device.host})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            <Input
              placeholder="Prefix customer code (default CUST)"
              value={importCustomerCodePrefix}
              onChange={(event) => setImportCustomerCodePrefix(event.target.value)}
            />

            <div className="rounded-lg border-2 border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              Parsed {importPreview.rows.length} row valid · {importPreview.errors.length} row invalid
            </div>
          </div>

          <textarea
            className="min-h-[180px] w-full rounded-lg border-2 border-input bg-card px-3 py-2 text-sm text-foreground shadow-brutal-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={[
              "NAME | ALAMAT | NOMOR HP | PPPOE | PAKET | CUSTOMER_CODE | NEXT_BILLING_AT | MIKROTIK",
              "Budi Santoso | Jl. Melati 1 | 08123456789 | budi01 | HOME20 | CUST-BUDI | 2026-05-01 | mtk-core-1",
              "Sari Wulan | Jl. Mawar 2 | 08129876543 | sari02 | HOME50 |  |  | 192.168.88.10",
            ].join("\n")}
            value={importRawText}
            onChange={(event) => setImportRawText(event.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={importCustomersMutation.isPending}
              onClick={() => importCustomersMutation.mutate()}
              type="button"
            >
              Import Sekarang
            </Button>
            <Button
              onClick={() => setImportRawText("")}
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          </div>

          {importPreview.rows.length > 0 ? (
            <div className="rounded-xl border-2 border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Preview (maks 5 row)</p>
              <div className="mt-2 space-y-2">
                {importPreview.rows.slice(0, 5).map((row) => (
                  <div className="rounded-lg border border-border px-2 py-1.5 text-xs" key={`${row.lineNo}-${row.pppoe}`}>
                    <span className="font-semibold">L{row.lineNo}</span> · {row.name} · {row.pppoe} · Paket: {row.packageName}
                    {row.mikrotikHint ? ` · MikroTik: ${row.mikrotikHint}` : ""}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(importPreview.errors.length > 0 || importRuntimeErrors.length > 0) ? (
            <div className="rounded-xl border-2 border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-destructive">Import errors</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-destructive">
                {[...importPreview.errors, ...importRuntimeErrors].slice(0, 20).map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customers</CardTitle>
            <CardDescription>Status customer billing + next billing date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="Cari pelanggan (nama / code / no hp / pppoe / paket / status)"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />

            <p className="text-xs text-muted-foreground">
              Menampilkan {Math.min(filteredCustomers.length, 50)} dari {filteredCustomers.length} hasil pencarian.
            </p>

            {filteredCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada pelanggan yang cocok.</p>
            ) : (
              filteredCustomers.slice(0, 50).map((customer) => (
                <div className="rounded-xl border-2 border-border bg-card px-3 py-2" key={customer.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{customer.full_name}</p>
                      <p className="text-xs text-muted-foreground">{customer.customer_code} · {customer.service_plan_name}</p>
                    </div>
                    <Badge variant={getCustomerVariant(customer.status)}>{customer.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Phone: {customer.phone || "-"} · PPPoE: {customer.ppp_secret_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Next billing: {formatDateTime(customer.next_billing_at)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open Invoices</CardTitle>
            <CardDescription>Catat pembayaran langsung dari daftar invoice.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingInvoiceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada invoice terbuka.</p>
            ) : (
              pendingInvoiceRows.map((invoice: BillingInvoice) => {
                const remaining = Math.max(0, invoice.amount - invoice.paid_amount);

                return (
                  <div className="rounded-xl border-2 border-border bg-card px-3 py-2" key={invoice.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                        <p className="text-xs text-muted-foreground">{invoice.customer_name} · due {invoice.due_date}</p>
                      </div>
                      <Badge variant={getInvoiceVariant(invoice.status)}>{invoice.status}</Badge>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <div className="text-xs text-muted-foreground">
                        Total {toRupiah(invoice.amount)} · Paid {toRupiah(invoice.paid_amount)} · Remaining {toRupiah(remaining)}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          className="h-10 sm:w-36"
                          placeholder="Amount"
                          type="number"
                          value={paymentDrafts[invoice.id] ?? String(remaining)}
                          onChange={(event) =>
                            setPaymentDrafts((prev) => ({
                              ...prev,
                              [invoice.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          className="h-10"
                          disabled={createPaymentMutation.isPending}
                          onClick={() => {
                            const amount = Number.parseInt(paymentDrafts[invoice.id] ?? String(remaining), 10);
                            createPaymentMutation.mutate({ invoiceId: invoice.id, amount });
                          }}
                          type="button"
                        >
                          Pay
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent Payments</CardTitle>
          <CardDescription>Riwayat pembayaran terbaru dari endpoint backend billing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada pembayaran.</p>
          ) : (
            recentPayments.map((payment) => (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border bg-card px-3 py-2" key={payment.id}>
                <div>
                  <p className="text-sm font-semibold text-foreground">Invoice #{payment.invoice_id}</p>
                  <p className="text-xs text-muted-foreground">{payment.method || "cash"} · {formatDateTime(payment.paid_at)}</p>
                </div>
                <Badge variant="success">{toRupiah(payment.amount)}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
