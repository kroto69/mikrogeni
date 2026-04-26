import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpDown, Filter, RefreshCcw, Search, X, Zap } from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import OLTSelector from "@/components/olt/OLTSelector";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PageSectionHeader } from "@/components/page/section-header";
import { getAcsDeviceDetail, getAcsDevices, getApiErrorMessage, refreshAcsDevices } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { isAcsDeviceIncomplete } from "@/types/onu";
import type { AcsDeviceListItem, OnuDevice, OnuDeviceDetail, OnuStatus } from "@/types/onu";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

type FilterTab = "all" | OnuStatus;
type SortKey = "id" | "serialNumber" | "vendorType" | "pppoeUsername" | "ipAddress" | "rxDbm" | "lastInformAt";
type SortDirection = "asc" | "desc";

function getOnuStatus(lastInform: string): OnuStatus {
  const informedAt = new Date(lastInform).getTime();

  if (Number.isNaN(informedAt)) {
    return "offline";
  }

  const ageMs = Date.now() - informedAt;
  return ageMs < 5 * 60 * 1000 ? "online" : "offline";
}

function formatLastInform(lastInform: string) {
  const informedAt = new Date(lastInform);

  if (Number.isNaN(informedAt.getTime())) {
    return lastInform;
  }

  const diffMs = Date.now() - informedAt.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function isMutedValue(value: string | null | undefined) {
  return value === null || value === undefined || value.trim() === "" || value === "-";
}

function formatDisplayValue(value: string | null | undefined) {
  return isMutedValue(value) ? "-" : value;
}

function OverlayPanel({
  open,
  title,
  description,
  onClose,
  titleId,
  descriptionId,
  closeButtonRef,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  titleId: string;
  descriptionId: string;
  closeButtonRef: React.RefObject<HTMLButtonElement>;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-foreground/40 p-3 sm:p-6">
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border-2 border-border bg-card text-card-foreground shadow-brutal-lg"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-border px-5 py-4 sm:px-6">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground" id={titleId}>{title}</h3>
            {description ? <p className="text-sm text-muted-foreground" id={descriptionId}>{description}</p> : null}
          </div>
          <Button className="h-8 w-8 p-0" onClick={onClose} ref={closeButtonRef} type="button" variant="outline">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function CompactDetailRow({ label, value, muted = false }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-start sm:gap-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">{label}</dt>
      <dd className={cn("break-all text-[13px] font-medium text-foreground sm:text-sm", muted && "text-muted-foreground")}>{value}</dd>
    </div>
  );
}

function OnuDetailOverlayContent({
  detail,
  status,
  onOpenFullPage,
  onRefresh,
  isRefreshing,
}: {
  detail: OnuDeviceDetail;
  status: OnuStatus;
  onOpenFullPage: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const firstWifiProfile = detail.wifi_profiles[0];
  const ssid1Value = firstWifiProfile?.ssid?.trim() ? firstWifiProfile.ssid : "-";
  const ssid1PasswordValue = firstWifiProfile?.password?.trim() ? firstWifiProfile.password : "-";
  const rxValue = detail.rx_power === null ? "-" : `${detail.rx_power} dBm`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-border bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status === "online" ? "success" : "destructive"}>{status}</Badge>
          <Badge variant="secondary">{detail.vendor} {detail.device_type}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onOpenFullPage} size="sm" type="button" variant="outline">Open full page</Button>
          <Button disabled={isRefreshing} onClick={onRefresh} size="sm" type="button" variant="outline">
            <RefreshCcw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing..." : "Refresh detail"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-border bg-muted/20 px-4 py-3 sm:px-5">
        <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Device ID</dt>
            <dd className={cn("text-sm font-semibold text-foreground", isMutedValue(detail.device_id) && "text-muted-foreground")}>
              {formatDisplayValue(detail.device_id)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Serial Number</dt>
            <dd className={cn("text-sm font-semibold text-foreground", isMutedValue(detail.serial_number) && "text-muted-foreground")}>
              {formatDisplayValue(detail.serial_number)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-2xl border-2 border-border bg-card/95 px-4 py-3 shadow-brutal-sm sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">PPPoE & WAN</p>
          <dl className="mt-2 divide-y divide-border/70">
            <CompactDetailRow label="PPPoE Username" muted={isMutedValue(detail.pppoe_username)} value={formatDisplayValue(detail.pppoe_username)} />
            <CompactDetailRow label="WAN IP" muted={isMutedValue(detail.ip_pppoe)} value={formatDisplayValue(detail.ip_pppoe)} />
            <CompactDetailRow label="Uptime" muted={isMutedValue(detail.device_uptime)} value={formatDisplayValue(detail.device_uptime)} />
          </dl>
        </section>

        <section className="rounded-2xl border-2 border-border bg-card/95 px-4 py-3 shadow-brutal-sm sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">SSID & RX</p>
          <dl className="mt-2 divide-y divide-border/70">
            <CompactDetailRow label="SSID 1" muted={isMutedValue(ssid1Value)} value={formatDisplayValue(ssid1Value)} />
            <CompactDetailRow label="Password SSID 1" muted={isMutedValue(ssid1PasswordValue)} value={formatDisplayValue(ssid1PasswordValue)} />
            <CompactDetailRow label="RX" value={rxValue} muted={detail.rx_power === null} />
          </dl>
        </section>
      </div>
    </div>
  );
}

function mapAcsDeviceToOnuDevice(device: AcsDeviceListItem): OnuDevice {
  const pppoeUsername = (device.pppoe_username ?? device.pppoe) || "-";
  const ipAddress = (device.ip_address ?? device.ip) || "-";
  const rxDbm = device.rx_power ?? device.rx_optical;
  const temp = device.temp ?? null;
  const deviceUptime = device.device_uptime ?? "-";

  return {
    id: device.id,
    serialNumber: device.sn,
    vendorType: device.vendor_type,
    pppoeUsername,
    ipAddress,
    rxDbm,
    temp,
    deviceUptime,
    isIncomplete: isAcsDeviceIncomplete(device),
    lastInform: formatLastInform(device.last_inform),
    lastInformAt: device.last_inform,
    status: getOnuStatus(device.last_inform),
  };
}

export default function OnuIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastInformAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [detailDeviceId, setDetailDeviceId] = useState<string | null>(null);
  const closeOverlayButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["acs-devices"],
    queryFn: getAcsDevices,
  });

  const detailQuery = useQuery({
    queryKey: ["onu-detail-overlay", detailDeviceId],
    queryFn: () => getAcsDeviceDetail(detailDeviceId ?? "", { activeOnly: false }),
    enabled: Boolean(detailDeviceId),
  });

  const devices = useMemo(() => (data ?? []).map(mapAcsDeviceToOnuDevice), [data]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === detailDeviceId) ?? null,
    [detailDeviceId, devices],
  );

  const counts = useMemo(
    () => ({
      all: devices.length,
      online: devices.filter((device) => device.status === "online").length,
      offline: devices.filter((device) => device.status === "offline").length,
    }),
    [devices],
  );

  const filteredDevices = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return devices.filter((device) => {
      const matchesTab = activeTab === "all" ? true : device.status === activeTab;
      if (!matchesTab) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [device.id, device.serialNumber, device.vendorType, device.pppoeUsername, device.ipAddress, device.deviceUptime, device.temp === null ? "" : String(device.temp)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [activeTab, devices, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (!detailDeviceId) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [detailDeviceId]);

  useEffect(() => {
    if (!detailDeviceId) {
      return;
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rafId = window.requestAnimationFrame(() => {
      closeOverlayButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      lastFocusedElementRef.current?.focus();
    };
  }, [detailDeviceId]);

  useEffect(() => {
    if (!detailDeviceId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailDeviceId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailDeviceId]);

  const sortedDevices = useMemo(() => {
    const sorted = [...filteredDevices];

    sorted.sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];

      if (sortKey === "rxDbm") {
        const leftNumber = left.rxDbm ?? Number.NEGATIVE_INFINITY;
        const rightNumber = right.rxDbm ?? Number.NEGATIVE_INFINITY;
        return sortDirection === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
      }

      if (sortKey === "lastInformAt") {
        const leftTime = new Date(String(leftValue)).getTime();
        const rightTime = new Date(String(rightValue)).getTime();
        return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
      }

      const leftText = String(leftValue ?? "").toLowerCase();
      const rightText = String(rightValue ?? "").toLowerCase();
      const compared = leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? compared : -compared;
    });

    return sorted;
  }, [filteredDevices, sortDirection, sortKey]);

  const paginatedDevices = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedDevices.slice(start, start + pageSize);
  }, [page, pageSize, sortedDevices]);

  useEffect(() => {
    setSelectedDeviceIds((current) => current.filter((deviceId) => devices.some((device) => device.id === deviceId && device.isIncomplete)));
  }, [devices]);

  const visibleIncompleteIds = paginatedDevices.filter((device) => device.isIncomplete).map((device) => device.id);
  const allVisibleIncompleteSelected = visibleIncompleteIds.length > 0 && visibleIncompleteIds.every((deviceId) => selectedDeviceIds.includes(deviceId));

  const summonSelectedMutation = useMutation({
    mutationFn: async (deviceIds: string[]) => {
      if (deviceIds.length === 0) {
        throw new Error("No incomplete ONU devices selected.");
      }

      return refreshAcsDevices({
        device_ids: deviceIds,
        object_name: "",
      });
    },
    onSuccess: async (response) => {
      setSelectedDeviceIds([]);
      showToast({
        title: response.message || "Summon queued",
        description: `${response.queued_count}/${response.total_count} incomplete ONU devices queued for refresh.`,
        variant: "success",
      });
      await queryClient.invalidateQueries({ queryKey: ["acs-devices"] });
    },
    onError: (mutationError) => {
      showToast({
        title: "Summon selected devices failed",
        description: getApiErrorMessage(mutationError),
        variant: "error",
      });
    },
  });

  const handleManualRefresh = async () => {
    try {
      const result = await refetch();
      if (result.error) {
        throw result.error;
      }

      showToast({
        title: "Inventory refreshed",
        description: "ONU discovery data was refreshed manually.",
        variant: "success",
      });
    } catch (refetchError) {
      showToast({
        title: "Refresh failed",
        description: getApiErrorMessage(refetchError),
        variant: "error",
      });
    }
  };

  const isInventoryActionPending = isFetching || summonSelectedMutation.isPending;

  const toggleSelectedDevice = (deviceId: string) => {
    setSelectedDeviceIds((current) => current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId]);
  };

  const handleToggleVisibleIncomplete = () => {
    if (visibleIncompleteIds.length === 0) {
      return;
    }

    setSelectedDeviceIds((current) => {
      if (allVisibleIncompleteSelected) {
        return current.filter((id) => !visibleIncompleteIds.includes(id));
      }

      return Array.from(new Set([...current, ...visibleIncompleteIds]));
    });
  };

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "lastInformAt" ? "desc" : "asc");
  };

  const handleOpenDetailOverlay = (deviceId: string) => {
    setDetailDeviceId(deviceId);
  };

  const handleCloseDetailOverlay = () => {
    setDetailDeviceId(null);
  };

  const renderSortHeader = (label: string, key: SortKey) => (
    <button
      className={cn(
        "inline-flex items-center gap-1 text-left transition-colors",
        sortKey === key ? "text-foreground" : "text-muted-foreground",
      )}
      onClick={() => handleSort(key)}
      type="button"
    >
      <span>{label}</span>
      <ArrowUpDown className="h-3.5 w-3.5" />
    </button>
  );

  const summaryCards = [
    { key: "all" as FilterTab, label: "Devices", value: String(counts.all), note: "Global", variant: "default" as const },
    { key: "online" as FilterTab, label: "Online", value: String(counts.online), note: "Healthy", variant: "success" as const },
    { key: "offline" as FilterTab, label: "Offline", value: String(counts.offline), note: "Critical", variant: "destructive" as const },
  ];

  const renderSummaryRail = (className?: string) => (
    <section className={cn("grid grid-cols-3 gap-2 rounded-[22px] border-2 border-border bg-card px-1 py-1 shadow-brutal sm:gap-4 xl:grid-cols-3", className)}>
      {summaryCards.map((item) => (
        <button
          className="text-left"
          key={item.label}
          onClick={() => {
            setActiveTab(item.key);
            setPage(1);
          }}
          type="button"
        >
          <Card className={cn(
            "bg-card transition-all",
            activeTab === item.key ? "ring-2 ring-border bg-primary text-primary-foreground" : "",
          )}>
            <CardContent className="p-2 sm:flex sm:items-center sm:justify-between sm:p-6">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      item.variant === "success"
                        ? "bg-success"
                        : item.variant === "destructive"
                          ? "bg-destructive"
                          : "bg-primary",
                    )}
                  />
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-sm sm:normal-case sm:tracking-normal">
                    {item.label}
                  </p>
                </div>
                <p className="text-[1.35rem] font-semibold leading-none text-foreground sm:mt-2 sm:text-3xl">{item.value}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground sm:hidden">{item.note}</p>
              </div>
              <Badge className="mt-3 hidden sm:inline-flex" variant={item.variant}>{item.note}</Badge>
            </CardContent>
          </Card>
        </button>
      ))}
    </section>
  );

  return (
    <div className="route-shell-page route-shell-onu mx-auto max-w-[22rem] space-y-3 px-1 sm:max-w-none sm:space-y-6 sm:px-0">
      <section className="route-shell-panel rounded-[26px] border-2 border-border bg-card/95 px-3.5 py-4 shadow-brutal sm:px-5 sm:py-5">
        <PageSectionHeader
        badge={<Button className="inline-flex items-center gap-2" onClick={() => navigate("/dashboard")} size="sm" type="button" variant="outline"><ArrowLeft className="h-4 w-4" />Back</Button>}
        title={
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-lg font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">ONU Inventory</h1>
            <p className="text-sm font-semibold text-muted-foreground">Search, refresh, and summon the latest ONU discovery data.</p>
          </div>
        }
        meta={<span className="inline-flex rounded-full border-2 border-border bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">{counts.all} total</span>}
        actions={
          <div className="grid w-full gap-3">
            <OLTSelector />
            <div className="relative min-w-0 w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-10 w-full rounded-lg border-2 border-input bg-card pl-10 pr-3 text-sm text-foreground shadow-brutal-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setPage(1);
                }}
                placeholder="Search SN, IP, PPPoE, Device ID..."
                value={searchTerm}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button className="h-10 rounded-2xl text-[12px] font-semibold" disabled={isInventoryActionPending} onClick={() => void handleManualRefresh()} type="button" variant="outline">
                <RefreshCcw className="mr-2 h-4 w-4" />
                {isFetching ? "Refreshing..." : "Refresh"}
              </Button>
              <Button className="h-10 rounded-2xl text-[12px] font-semibold" disabled={isInventoryActionPending || visibleIncompleteIds.length === 0} onClick={handleToggleVisibleIncomplete} type="button" variant="outline">
                <Filter className="mr-2 h-4 w-4" />
                {allVisibleIncompleteSelected ? "Clear visible" : "Select visible"}
              </Button>
            </div>
            <Button className="h-10 w-full rounded-2xl text-[12px] font-semibold" disabled={isInventoryActionPending || selectedDeviceIds.length === 0} onClick={() => summonSelectedMutation.mutate(selectedDeviceIds)} type="button">
              <Zap className="mr-2 h-4 w-4" />
              {summonSelectedMutation.isPending ? "Summoning..." : `Summon selected (${selectedDeviceIds.length})`}
            </Button>
            <div className="flex justify-end">
              <select
                className="h-10 rounded-lg border-2 border-input bg-card px-3 text-sm font-medium text-foreground shadow-brutal-sm"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}/page
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
      />
      </section>

      {renderSummaryRail()}

      {isError ? (
        <Card className="border-2 shadow-brutal-sm">
          <CardContent className="px-4 py-3 text-sm text-destructive">{getApiErrorMessage(error)}</CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">Only eligible devices can be selected and summoned.</p>

      <div className="max-h-[62vh] overflow-y-auto overscroll-contain pr-1 sm:max-h-[66vh] xl:max-h-[68vh]">
      {!isError ? (
      <Card className="border-2 shadow-brutal">
        <CardContent className="p-0">

          {isLoading ? (
            <div className="px-6 py-10 text-sm text-muted-foreground">Loading ONU inventory...</div>
          ) : null}

          {!isLoading && !isError ? (
            <>
              <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                <tr>
                  <th className="px-6 py-4">Select</th>
                  <th className="px-6 py-4">{renderSortHeader("Device ID", "id")}</th>
                  <th className="px-6 py-4">{renderSortHeader("Serial Number", "serialNumber")}</th>
                  <th className="px-6 py-4">{renderSortHeader("Type / Vendor", "vendorType")}</th>
                  <th className="px-6 py-4">{renderSortHeader("PPPoE User", "pppoeUsername")}</th>
                  <th className="px-6 py-4">{renderSortHeader("IP Address", "ipAddress")}</th>
                  <th className="px-6 py-4">{renderSortHeader("RX (dBm)", "rxDbm")}</th>
                  <th className="px-6 py-4">{renderSortHeader("Last Inform", "lastInformAt")}</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDevices.map((device) => (
                  <tr key={device.id} className="border-t border-border/80 text-foreground">
                    <td className="px-6 py-4">
                      {device.isIncomplete ? (
                        <input checked={selectedDeviceIds.includes(device.id)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary" onChange={() => toggleSelectedDevice(device.id)} type="checkbox" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium">{device.id}</td>
                    <td className="px-6 py-4 font-semibold text-foreground">{device.serialNumber}</td>
                    <td className="px-6 py-4">{device.vendorType}</td>
                    <td className="px-6 py-4">{device.pppoeUsername}</td>
                    <td className="px-6 py-4">{device.ipAddress}</td>
                    <td className="px-6 py-4">
                      {device.rxDbm === null ? (
                        <span className="text-muted-foreground">N/A</span>
                      ) : (
                        <span className={device.rxDbm < -27 ? "text-destructive" : "text-success"}>{device.rxDbm}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <span className={device.status === "offline" ? "text-destructive" : "text-foreground"}>{device.lastInform}</span>
                        <p className="text-xs text-muted-foreground">{new Date(device.lastInformAt).toLocaleString()}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={device.status === "online" ? "success" : "destructive"}>{device.status}</Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                        onClick={() => handleOpenDetailOverlay(device.id)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

              <div className="space-y-2 bg-muted/15 p-2 lg:hidden">
                {paginatedDevices.map((device) => (
                  <Card
                    key={device.id}
                      className={cn(
                      "neo-panel neo-interactive overflow-hidden border-2 bg-card",
                      device.status === "online"
                        ? "ring-2 ring-success"
                        : device.rxDbm !== null && device.rxDbm < -27
                          ? "ring-2 ring-warning"
                          : "ring-2 ring-destructive",
                    )}
                  >
                    <CardContent className="p-0">
                      <div className="flex items-start gap-2.5 px-3 py-2.5">
                        <div
                          className={cn(
                            "mt-0.5 h-10 w-1 rounded-full shrink-0 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]",
                            device.status === "online"
                              ? "bg-success"
                              : device.rxDbm !== null && device.rxDbm < -27
                                ? "bg-warning"
                                : "bg-destructive",
                          )}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              {device.id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-semibold leading-tight text-foreground">{device.serialNumber}</p>
                              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{device.vendorType}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {device.isIncomplete ? (
                                <input checked={selectedDeviceIds.includes(device.id)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary" onChange={() => toggleSelectedDevice(device.id)} type="checkbox" />
                              ) : null}
                              <div
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold",
                                  device.status === "online"
                                    ? "bg-success text-success-foreground"
                                    : device.rxDbm !== null && device.rxDbm < -27
                                      ? "bg-warning text-warning-foreground"
                                      : "bg-destructive text-destructive-foreground",
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    device.status === "online"
                                      ? "bg-success"
                                      : device.rxDbm !== null && device.rxDbm < -27
                                        ? "bg-warning"
                                        : "bg-destructive",
                                  )}
                                />
                                {device.status === "online"
                                  ? "Online"
                                  : device.rxDbm !== null && device.rxDbm < -27
                                    ? "Warning"
                                    : "Offline"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-border bg-muted/20 px-2.5 py-2">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-[11px] font-medium text-foreground">{device.pppoeUsername}</p>
                              <p className="truncate text-[10px] text-muted-foreground">{device.ipAddress}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <div className="text-right">
                                <p className={cn("text-[11px] font-semibold", device.rxDbm === null ? "text-muted-foreground" : device.rxDbm < -27 ? "text-warning" : "text-success")}>
                                  {device.rxDbm === null ? "-" : `${device.rxDbm} dBm`}
                                </p>
                              </div>
                              <button
                                className={cn(
                                  buttonVariants({ size: "sm", variant: "outline" }),
                                  "h-7 px-2.5 text-[10px] font-semibold",
                                )}
                                onClick={() => handleOpenDetailOverlay(device.id)}
                                type="button"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {paginatedDevices.length === 0 ? (
                <div className="px-6 py-10 text-sm text-muted-foreground">No ONU devices found for the selected filter.</div>
              ) : null}

              <div className="flex flex-col gap-3 border-t-2 border-border px-4 py-4 text-sm text-muted-foreground sm:px-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-center sm:text-left">
                  Showing {filteredDevices.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredDevices.length)} of {filteredDevices.length}
                </p>
                <p className="text-center text-xs sm:text-left">{visibleIncompleteIds.length} visible for refresh · {selectedDeviceIds.length} selected</p>
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                  <Button className="min-w-20" disabled={page === 1} onClick={() => setPage((current) => current - 1)} size="sm" variant="outline">
                    Prev
                  </Button>
                  <span className="px-2 text-foreground">
                    Page {page} / {totalPages}
                  </span>
                  <Button className="min-w-20" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)} size="sm" variant="outline">
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {isFetching && !isLoading ? <div className="border-t-2 border-border px-6 py-3 text-xs text-muted-foreground">Refreshing inventory...</div> : null}
        </CardContent>
      </Card>
      ) : null}
      </div>

      <OverlayPanel
        closeButtonRef={closeOverlayButtonRef}
        descriptionId="onu-detail-overlay-description"
        description={selectedDevice ? `${selectedDevice.serialNumber} · ${selectedDevice.vendorType}` : "ONU detail snapshot"}
        onClose={handleCloseDetailOverlay}
        open={Boolean(detailDeviceId)}
        titleId="onu-detail-overlay-title"
        title={detailQuery.data?.device_id ?? detailDeviceId ?? "ONU detail"}
      >
        {detailQuery.isLoading ? (
          <div className="space-y-2 py-8 text-sm text-muted-foreground">
            <p>Loading ONU detail...</p>
          </div>
        ) : detailQuery.isError ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm text-destructive">{getApiErrorMessage(detailQuery.error)}</p>
              <Button onClick={() => void detailQuery.refetch()} size="sm" type="button" variant="outline">
                <RefreshCcw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : detailQuery.data ? (
          <OnuDetailOverlayContent
            detail={detailQuery.data}
            isRefreshing={detailQuery.isFetching}
            onOpenFullPage={() => {
              if (!detailDeviceId) {
                return;
              }

              handleCloseDetailOverlay();
              navigate(`/onu/${detailDeviceId}`);
            }}
            onRefresh={() => {
              void detailQuery.refetch();
            }}
            status={getOnuStatus(detailQuery.data.last_inform_at)}
          />
        ) : (
          <p className="py-8 text-sm text-muted-foreground">No ONU detail available.</p>
        )}
      </OverlayPanel>
    </div>
  );
}
