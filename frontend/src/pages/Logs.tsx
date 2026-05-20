import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  reboot_onu: { label: "Reboot ONU", variant: "destructive" },
  rename_onu: { label: "Rename ONU", variant: "default" },
  kick_ppp: { label: "Kick PPP", variant: "destructive" },
  edit_ppp_secret: { label: "Edit Secret", variant: "secondary" },
  create_ppp_secret: { label: "Create Secret", variant: "default" },
  delete_ppp_secret: { label: "Delete Secret", variant: "destructive" },
  create_ppp_profile: { label: "Create Profile", variant: "default" },
  update_ppp_profile: { label: "Update Profile", variant: "secondary" },
  delete_ppp_profile: { label: "Delete Profile", variant: "destructive" },
  create_mikrotik_device: { label: "Add MikroTik", variant: "default" },
  delete_mikrotik_device: { label: "Remove MikroTik", variant: "destructive" },
  create_olt_device: { label: "Add OLT", variant: "default" },
  delete_olt_device: { label: "Remove OLT", variant: "destructive" },
  login: { label: "Login", variant: "secondary" },
  config_wifi: { label: "Config WiFi", variant: "secondary" },
  config_wan: { label: "Config WAN", variant: "secondary" },
  config_security: { label: "Config Security", variant: "secondary" },
  update_setting: { label: "Update Setting", variant: "secondary" },
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
            <div className="divide-y divide-border/50">
              {logs.map((log) => {
                const actionInfo = ACTION_LABELS[log.action] ?? { label: log.action, variant: "secondary" as const };
                return (
                  <div key={log.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="shrink-0 text-[10px] text-muted-foreground w-28">{formatTime(log.created_at)}</span>
                    <Badge variant={actionInfo.variant} className="shrink-0">{actionInfo.label}</Badge>
                    <span className="truncate text-foreground">{log.target || ""}{log.device ? ` · ${log.device}` : ""}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{log.username}</span>
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
