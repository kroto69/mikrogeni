import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";

type ActivityLog = {
  id: number;
  username: string;
  action: string;
  target: string;
  device: string;
  detail: string;
  created_at: string;
};

async function fetchActivityLogs(limit: number, offset: number): Promise<{ data: ActivityLog[]; total: number }> {
  const resp = await api.get<{ data: ActivityLog[]; total: number }>("/activity-logs", { params: { limit, offset } });
  return resp.data;
}

const ACTION_LABELS: Record<string, { label: string }> = {
  reboot_onu: { label: "Reboot ONU" },
  rename_onu: { label: "Rename ONU" },
  kick_ppp: { label: "Kick PPP" },
  edit_ppp_secret: { label: "Edit Secret" },
  create_ppp_secret: { label: "Create Secret" },
  delete_ppp_secret: { label: "Delete Secret" },
  create_ppp_profile: { label: "Create Profile" },
  update_ppp_profile: { label: "Update Profile" },
  delete_ppp_profile: { label: "Delete Profile" },
  create_mikrotik_device: { label: "Add MikroTik" },
  delete_mikrotik_device: { label: "Remove MikroTik" },
  create_olt_device: { label: "Add OLT" },
  delete_olt_device: { label: "Remove OLT" },
  login: { label: "Login" },
  config_wifi: { label: "Config WiFi" },
  config_wan: { label: "Config WAN" },
  config_security: { label: "Config Security" },
  update_setting: { label: "Update Setting" },
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function LogsPage() {
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: () => fetchActivityLogs(limit, 0),
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="route-shell-page space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black uppercase tracking-tight">Activity Logs</h1>
        <span className="text-sm text-muted-foreground">{total} entries</span>
      </div>

      <Card className="overflow-hidden border-2 shadow-brutal">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Loading...</div>
          ) : logs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">No activity logs yet.</div>
          ) : (
            <div className="divide-y divide-border/30">
              {logs.map((log) => {
                const actionInfo = ACTION_LABELS[log.action] ?? { label: log.action };
                return (
                  <div key={log.id} className="px-3 py-1.5 text-[11px] flex items-baseline justify-between gap-2">
                    <span className="text-foreground"><span className="font-bold">{actionInfo.label}</span>{log.target ? ` ${log.target}` : ""}{log.device ? ` · ${log.device}` : ""} — {log.username}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(log.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
