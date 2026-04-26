import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageSectionHeader } from "@/components/page/section-header";
import { Link } from "react-router-dom";

export default function PluginPage() {
  return (
    <div className="route-shell-page route-shell-plugin space-y-4">
      <section className="route-shell-panel rounded-[24px] border border-border/80 bg-card/95 px-4 py-4 shadow-panel sm:px-5">
        <PageSectionHeader
          badge={<Badge>Plugin</Badge>}
          description="Vendor-specific integrations live here. HIOSOO OLT is ready to connect through nginx."
          title="Plugin"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Link to="/plugin/olt/hioso">
          <Card className="h-full transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal-lg">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Badge>OLT</Badge>
                  <h3 className="mt-2 text-lg font-semibold text-foreground">HIOSOO</h3>
                </div>
                <Badge variant="success">Ready</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Manage HIOSOO OLT devices, PONs, and ONUs through the plugin backend.</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
