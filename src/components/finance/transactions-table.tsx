import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatUsd } from "@/lib/utils";

const TYPE_PILL = {
  REVENUE: { tone: "success", label: "Revenue" },
  EXPENSE: { tone: "info", label: "Expense" },
  REFUND: { tone: "warning", label: "Refund" },
} as const;

export function TransactionsTable({
  rows,
}: {
  rows: {
    id: string;
    occurredAt: Date;
    description: string;
    department: string;
    type: "REVENUE" | "EXPENSE" | "REFUND";
    amountUsd: number;
  }[];
}) {
  return (
    <div className="overflow-x-auto">
      <Table data-testid="transactions">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="hidden md:table-cell">Department</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const pill = TYPE_PILL[t.type];
            const sign = t.type === "REVENUE" ? "+" : "-";
            return (
              <TableRow key={t.id}>
                <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                  {t.occurredAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </TableCell>
                <TableCell className="text-sm">{t.description}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {t.department}
                </TableCell>
                <TableCell>
                  <Badge tone={pill.tone}>{pill.label}</Badge>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right text-sm font-medium whitespace-nowrap tabular-nums",
                    t.type === "REVENUE" ? "text-success" : "text-foreground",
                  )}
                >
                  {sign}
                  {formatUsd(t.amountUsd)}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge tone="success">Posted</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
