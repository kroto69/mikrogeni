import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOLTDevices } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useOltSelector } from "@/hooks/useOltSelector";

type OLTSelectorProps = {
  className?: string;
  label?: string;
};

export default function OLTSelector({ className, label = "OLT aktif" }: OLTSelectorProps) {
  const { selectedOltId, setSelectedOltId } = useOltSelector();

  const { data, isLoading } = useQuery({
    queryKey: ["olt-devices", "selector"],
    queryFn: getOLTDevices,
    refetchInterval: 15_000,
  });

  const onlineOLTs = useMemo(
    () => (data ?? []).filter((olt) => olt.status === "online"),
    [data],
  );

  useEffect(() => {
    if (!selectedOltId) {
      return;
    }

    const stillOnline = onlineOLTs.some((olt) => olt.id === selectedOltId);
    if (!stillOnline) {
      setSelectedOltId(null);
    }
  }, [onlineOLTs, selectedOltId, setSelectedOltId]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <select
        className="h-10 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={isLoading || onlineOLTs.length === 0}
        onChange={(event) => {
          const value = event.target.value;
          setSelectedOltId(value === "" ? null : value);
        }}
        value={selectedOltId ?? ""}
      >
        <option value="">{isLoading ? "Loading OLT..." : onlineOLTs.length === 0 ? "Tidak ada OLT online" : "Pilih OLT online"}</option>
        {onlineOLTs.map((olt) => (
          <option key={olt.id} value={olt.id}>
            {olt.name} ({olt.endpoint})
          </option>
        ))}
      </select>
    </div>
  );
}
