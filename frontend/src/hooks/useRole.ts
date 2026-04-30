import { useAuth } from "./useAuth";

type Feature =
  | "onu_reboot"
  | "onu_edit"
  | "onu_view"
  | "onu_refresh"
  | "zte_connections_crud"
  | "zte_view"
  | "mikrotik_ppp_write"
  | "mikrotik_view"
  | "billing"
  | "settings"
  | "user_management";

const featureMap: Record<Feature, string[]> = {
  onu_reboot: ["admin"],
  onu_edit: ["admin"],
  onu_view: ["admin", "teknisi"],
  onu_refresh: ["admin", "teknisi"],
  zte_connections_crud: ["admin"],
  zte_view: ["admin", "teknisi"],
  mikrotik_ppp_write: ["admin"],
  mikrotik_view: ["admin", "teknisi"],
  billing: ["admin"],
  settings: ["admin"],
  user_management: ["admin"],
};

export function useRole() {
  const { user } = useAuth();
  const role = user?.role ?? "";

  const isAdmin = () => role === "admin";
  const isTeknisi = () => role === "teknisi" || role === "admin";
  const can = (feature: Feature) => {
    if (!user) return false;
    return featureMap[feature]?.includes(role) ?? false;
  };

  return { role, isAdmin, isTeknisi, can };
}