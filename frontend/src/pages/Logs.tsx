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
            <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : logs.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No activity logs yet.</div>
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="border-b-2 border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Time</th>
                      <th className="px-3 py-2 text-left">User</th>
                      <th className="px-3 py-2 text-left">Action</th>
                      <th className="px-3 py-2 text-left">Target</th>
                      <th className="px-3 py-2 text-left">Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const actionInfo = ACTION_LABELS[log.action] ?? { label: log.action, variant: "secondary" as const };
                      return (
                        <tr key={log.id} className="border-b border-border/50">
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatTime(log.created_at)}</td>
                          <td className="px-3 py-1.5 font-semibold">{log.username}</td>
                          <td className="px-3 py-1.5"><Badge variant={actionInfo.variant}>{actionInfo.label}</Badge></td>
                          <td className="px-3 py-1.5 font-mono">{log.target || "-"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{log.device || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2 p-3 lg:hidden">
                {logs.map((log) => {
                  const actionInfo = ACTION_LABELS[log.action] ?? { label: log.action, variant: "secondary" as const };
                  return (
                    <div key={log.id} className="rounded-lg border-2 border-border bg-card p-3 shadow-brutal-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={actionInfo.variant}>{actionInfo.label}</Badge>
                        <span className="text-[10px] text-muted-foreground">{formatTime(log.created_at)}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold">{log.target || "-"} <span className="text-muted-foreground">on</span> {log.device || "-"}</p>
                      <p className="text-xs text-muted-foreground">by {log.username}{log.detail ? ` · ${log.detail}` : ""}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
