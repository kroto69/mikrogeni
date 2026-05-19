import { useQuery } from "@tanstack/react-query";
import { getAcsSettings } from "@/lib/api";

export function useFeatureFlags() {
  const { data: settings } = useQuery({
    queryKey: ["acs-settings"],
    queryFn: getAcsSettings,
    staleTime: 60_000,
  });

  return {
    genieacsEnabled: settings?.genieacs_enabled !== "false",
    billingEnabled: settings?.billing_enabled !== "false",
  };
}
