import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { OLTDevice } from "@/lib/api";

type OLTTableProps = {
  devices: OLTDevice[];
  onHealthCheck: (oltId: string) => void;
  onDelete: (oltId: string) => void;
  activeHealthCheckId?: string | null;
  activeDeleteId?: string | null;
};

function renderStatusBadge(device: OLTDevice) {
  if (device.status === "online") {
    return <Badge variant="success">online</Badge>;
  }

  if (device.status === "offline") {
    return <Badge variant="destructive">offline</Badge>;
  }

  if (device.status === "error") {
    return (
      <Badge className="bg-[#7f1d1d] text-white" title={device.error_message ?? "Unknown error"} variant="destructive">
        error
      </Badge>
    );
  }

  return <Badge variant="secondary">unknown</Badge>;
}

export default function OLTTable({
  devices,
  onHealthCheck,
  onDelete,
  activeDeleteId,
  activeHealthCheckId,
}: OLTTableProps) {
  if (devices.length === 0) {
    return (
      <Card className="border-2 shadow-brutal-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Belum ada OLT terdaftar. Klik <span className="font-semibold text-foreground">Add OLT</span> untuk menambahkan OLT pertama.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 shadow-brutal">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Nama</th>
                <th className="px-4 py-3">Lokasi</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr className="border-t border-border/70 align-top" key={device.id}>
                  <td className="px-4 py-3 font-semibold text-foreground">{device.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{device.location?.trim() ? device.location : "-"}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <p className="break-all font-medium text-foreground">{device.endpoint}</p>
                      <p className="text-xs text-muted-foreground">SNMP {device.snmp_host}:{device.snmp_port}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {renderStatusBadge(device)}
                      {device.status === "error" && device.error_message ? (
                        <p className="max-w-[240px] text-xs text-muted-foreground" title={device.error_message}>{device.error_message}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={activeHealthCheckId === device.id}
                        onClick={() => onHealthCheck(device.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {activeHealthCheckId === device.id ? "Checking..." : "Health Check"}
                      </Button>
                      <Button
                        disabled={activeDeleteId === device.id}
                        onClick={() => onDelete(device.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {activeDeleteId === device.id ? "Deleting..." : "Hapus"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
