import type { IntegrationUptime, IntegrationFailure } from "@fm/shared/dto.js";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function IntegrationUptimeTable({ uptime }: { uptime: IntegrationUptime[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Integration uptime (7d)</CardTitle>
      </CardHeader>
      <CardContent>
        {uptime.length === 0 ? (
          <p className="text-sm text-muted-foreground">No integration events recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integration</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead>OK</TableHead>
                <TableHead>Deg</TableHead>
                <TableHead>Fail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uptime.map((r) => (
                <TableRow key={r.integration}>
                  <TableCell>
                    <code className="font-mono text-xs">{r.integration}</code>
                  </TableCell>
                  <TableCell>{r.uptime_pct != null ? `${r.uptime_pct}%` : "—"}</TableCell>
                  <TableCell>{r.ok_count}</TableCell>
                  <TableCell>{r.degraded_count}</TableCell>
                  <TableCell>{r.fail_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function IntegrationFailuresTable({ failures }: { failures: IntegrationFailure[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent failures</CardTitle>
      </CardHeader>
      <CardContent>
        {failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent failures.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Integration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.recorded_at)}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{r.integration}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
