import type { ReactNode } from "react";
import { Card, CardHeader, CardContent } from "../../components/ui/card.js";
export function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="shadow-none min-w-0 gap-5">
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="font-medium text-lg">{title}</h2>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            {description}
          </p>
        </div>
        {action}
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}
