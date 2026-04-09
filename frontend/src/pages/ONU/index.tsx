import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpDown, Filter, RefreshCcw, Search, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PageSectionHeader } from "@/components/page/section-header";
import { getAcsDevices, getApiErrorMessage, refreshAcsDevices } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { isAcsDeviceIncomplete } from "@/types/onu";
import type { AcsDeviceListItem, OnuDevice, OnuStatus } from "@/types/onu";

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["acs-devices"],
    queryFn: getAcsDevices,
  });

  const devices = useMemo(() => (data ?? []).map(mapAcsDeviceToOnuDevice), [data]);

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

  const renderSortHeader = (label: string, key: SortKey) => (
    <button
      className={cn(
        "inline-flex items-center gap-1 text-left transition-colors",
        sortKey === key ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400",
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
    <section className={cn("grid grid-cols-3 gap-2 rounded-[22px] border border-transparent bg-[linear-gradient(180deg,_rgba(247,251,255,0.98)_0%,_rgba(247,251,255,0.92)_100%)] px-1 py-1 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)] backdrop-blur dark:bg-[linear-gradient(180deg,_rgba(15,23,42,0.98)_0%,_rgba(15,23,42,0.9)_100%)] sm:gap-4 xl:grid-cols-3", className)}>
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
            "border-sky-100/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96)_0%,_rgba(246,250,255,0.96)_100%)] shadow-[0_10px_24px_-20px_rgba(37,99,235,0.35)] dark:border-slate-700 dark:bg-slate-950/95 transition-colors",
            activeTab === item.key ? "ring-2 ring-sky-500/60 dark:ring-sky-400/60" : "",
          )}>
            <CardContent className="p-2 sm:flex sm:items-center sm:justify-between sm:p-6">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      item.variant === "success"
                        ? "bg-emerald-600"
                        : item.variant === "destructive"
                          ? "bg-rose-600"
                          : "bg-sky-700",
                    )}
                  />
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:text-sm sm:normal-case sm:tracking-normal">
                    {item.label}
                  </p>
                </div>
                <p className="text-[1.35rem] font-semibold leading-none text-slate-950 sm:mt-2 sm:text-3xl">{item.value}</p>
                <p className="mt-0.5 text-[10px] text-slate-500 sm:hidden">{item.note}</p>
              </div>
              <Badge className="mt-3 hidden sm:inline-flex" variant={item.variant}>{item.note}</Badge>
            </CardContent>
          </Card>
        </button>
      ))}
    </section>
  );

  return (
    <div className="mx-auto max-w-[22rem] space-y-3 px-1 sm:max-w-none sm:space-y-6 sm:px-0">
      <PageSectionHeader
        title={
          <div className="flex items-center gap-3">
            <Button className="inline-flex items-center gap-2" onClick={() => navigate("/dashboard")} size="sm" variant="outline" type="button">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h1 className="text-lg font-semibold text-slate-950 dark:text-slate-100 sm:text-2xl">ONU Inventory</h1>
          </div>
        }
        description={<p className="text-sm text-slate-500 dark:text-slate-400">Search, refresh, and summon the latest ONU discovery data.</p>}
        meta={<span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-400 dark:text-slate-500">{counts.all} total</span>}
        actions={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                className="h-10 w-full rounded-2xl border border-slate-200 bg-white/95 pl-10 pr-3 text-sm text-slate-700 shadow-sm outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setPage(1);
                }}
                placeholder="Search SN, IP, PPPoE, Device ID..."
                value={searchTerm}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="h-10 rounded-2xl text-[12px] font-semibold" disabled={isInventoryActionPending} onClick={() => void handleManualRefresh()} type="button" variant="outline">
                <RefreshCcw className="mr-2 h-4 w-4" />
                {isFetching ? "Refreshing..." : "Refresh"}
              </Button>
              <Button className="h-10 rounded-2xl text-[12px] font-semibold" disabled={isInventoryActionPending || visibleIncompleteIds.length === 0} onClick={handleToggleVisibleIncomplete} type="button" variant="outline">
                <Filter className="mr-2 h-4 w-4" />
                {allVisibleIncompleteSelected ? "Clear visible" : "Select visible"}
              </Button>
              <Button className="h-10 rounded-2xl text-[12px] font-semibold" disabled={isInventoryActionPending || selectedDeviceIds.length === 0} onClick={() => summonSelectedMutation.mutate(selectedDeviceIds)} type="button">
                <Zap className="mr-2 h-4 w-4" />
                {summonSelectedMutation.isPending ? "Summoning..." : `Summon selected (${selectedDeviceIds.length})`}
              </Button>
            </div>
            <div>
              <select
                className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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

      {renderSummaryRail()}

      <p className="text-xs text-slate-500 dark:text-slate-400">Only eligible devices can be selected and summoned.</p>

      <div className="max-h-[62vh] overflow-y-auto overscroll-contain pr-1 sm:max-h-[66vh] xl:max-h-[68vh]">
      <Card>
        <CardContent className="p-0">

          {isLoading ? (
            <div className="px-6 py-10 text-sm text-slate-500">Loading ONU inventory...</div>
          ) : null}

          {isError ? (
            <div className="px-6 py-10 text-sm text-rose-600">{getApiErrorMessage(error)}</div>
          ) : null}

          {!isLoading && !isError ? (
            <>
              <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.15em] text-slate-500">
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
                  <tr key={device.id} className="border-t border-border/80 text-slate-700 dark:text-slate-300">
                    <td className="px-6 py-4">
                      {device.isIncomplete ? (
                        <input checked={selectedDeviceIds.includes(device.id)} className="h-4 w-4 rounded border-border text-sky-600 focus:ring-sky-500" onChange={() => toggleSelectedDevice(device.id)} type="checkbox" />
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium">{device.id}</td>
                    <td className="px-6 py-4 font-semibold text-sky-900 dark:text-sky-300">{device.serialNumber}</td>
                    <td className="px-6 py-4">{device.vendorType}</td>
                    <td className="px-6 py-4">{device.pppoeUsername}</td>
                    <td className="px-6 py-4">{device.ipAddress}</td>
                    <td className="px-6 py-4">
                      {device.rxDbm === null ? (
                        <span className="text-slate-400">N/A</span>
                      ) : (
                        <span className={device.rxDbm < -27 ? "text-rose-600" : "text-emerald-700"}>{device.rxDbm}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <span className={device.status === "offline" ? "text-rose-600" : "text-slate-700"}>{device.lastInform}</span>
                        <p className="text-xs text-slate-400">{new Date(device.lastInformAt).toLocaleString()}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={device.status === "online" ? "success" : "destructive"}>{device.status}</Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                        to={`/onu/${device.id}`}
                      >
                        View
                      </Link>
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
                      "overflow-hidden border border-white/90 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(250,252,255,0.98)_100%)] shadow-[0_16px_32px_-28px_rgba(15,23,42,0.32)] dark:border-slate-700 dark:bg-slate-950/95",
                      device.status === "online"
                        ? "ring-1 ring-emerald-100/80 dark:ring-emerald-900/60"
                        : device.rxDbm !== null && device.rxDbm < -27
                          ? "ring-1 ring-orange-100/80 dark:ring-orange-900/60"
                          : "ring-1 ring-rose-100/80 dark:ring-rose-900/60",
                    )}
                  >
                    <CardContent className="p-0">
                      <div className="flex items-start gap-2.5 px-3 py-2.5">
                        <div
                          className={cn(
                            "mt-0.5 h-10 w-1 rounded-full shrink-0 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]",
                            device.status === "online"
                              ? "bg-emerald-500"
                              : device.rxDbm !== null && device.rxDbm < -27
                                ? "bg-orange-500"
                                : "bg-rose-500",
                          )}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                              {device.id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-semibold leading-tight text-slate-950 dark:text-slate-100">{device.serialNumber}</p>
                              <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">{device.vendorType}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {device.isIncomplete ? (
                                <input checked={selectedDeviceIds.includes(device.id)} className="h-4 w-4 rounded border-border text-sky-600 focus:ring-sky-500" onChange={() => toggleSelectedDevice(device.id)} type="checkbox" />
                              ) : null}
                              <div
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold",
                                  device.status === "online"
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                    : device.rxDbm !== null && device.rxDbm < -27
                                      ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    device.status === "online"
                                      ? "bg-emerald-600"
                                      : device.rxDbm !== null && device.rxDbm < -27
                                        ? "bg-orange-500"
                                        : "bg-rose-600",
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
                          <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50/70 px-2.5 py-2 dark:bg-slate-900/80">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">{device.pppoeUsername}</p>
                              <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{device.ipAddress}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <div className="text-right">
                                <p className={cn("text-[11px] font-semibold", device.rxDbm === null ? "text-slate-400" : device.rxDbm < -27 ? "text-orange-600" : "text-emerald-700")}>
                                  {device.rxDbm === null ? "-" : `${device.rxDbm} dBm`}
                                </p>
                              </div>
                              <Link
                                className={cn(
                                  buttonVariants({ size: "sm", variant: "ghost" }),
                                  "h-7 rounded-xl bg-white px-2.5 text-[10px] font-semibold text-sky-800 shadow-sm hover:bg-sky-50 dark:bg-slate-950 dark:text-sky-300 dark:hover:bg-slate-900",
                                )}
                                to={`/onu/${device.id}`}
                              >
                                View
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {paginatedDevices.length === 0 ? (
                <div className="px-6 py-10 text-sm text-slate-500 dark:text-slate-400">No ONU devices found for the selected filter.</div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-slate-500 dark:text-slate-400 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-center sm:text-left">
                  Showing {filteredDevices.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredDevices.length)} of {filteredDevices.length}
                </p>
                <p className="text-center text-xs sm:text-left">{visibleIncompleteIds.length} visible for refresh · {selectedDeviceIds.length} selected</p>
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                  <Button className="min-w-20" disabled={page === 1} onClick={() => setPage((current) => current - 1)} size="sm" variant="outline">
                    Prev
                  </Button>
                  <span className="px-2 text-slate-600 dark:text-slate-300">
                    Page {page} / {totalPages}
                  </span>
                  <Button className="min-w-20" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)} size="sm" variant="outline">
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {isFetching && !isLoading ? <div className="border-t border-border px-6 py-3 text-xs text-slate-400 dark:text-slate-500">Refreshing inventory...</div> : null}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
