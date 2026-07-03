import type { RunFunnelDto } from "@fm/shared/dto.js";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function RunFunnelTable({ runs }: { runs: RunFunnelDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent runs</CardTitle>
        <CardDescription>
          Scraped → new → prefiltered out → scored (yes / maybe / no) → alerted, for your last runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No runs yet. Once the pipeline runs for your profile, its flow will show up here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Scraped</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Prefiltered out</TableHead>
                <TableHead>Yes</TableHead>
                <TableHead>Maybe</TableHead>
                <TableHead>No</TableHead>
                <TableHead>Alerted</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.startedAt)}</TableCell>
                  <TableCell>{r.scraped}</TableCell>
                  <TableCell>{r.new}</TableCell>
                  <TableCell>{r.prefiltered}</TableCell>
                  <TableCell>{r.scoredYes}</TableCell>
                  <TableCell>{r.scoredMaybe}</TableCell>
                  <TableCell>{r.scoredNo}</TableCell>
                  <TableCell>{r.alerted}</TableCell>
                  <TableCell>
                    {r.hadError ? (
                      <Badge variant="destructive">Error</Badge>
                    ) : r.finishedAt ? (
                      <Badge variant="success">OK</Badge>
                    ) : (
                      <Badge variant="secondary">Running</Badge>
                    )}
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
