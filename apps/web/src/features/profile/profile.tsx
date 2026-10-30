import { LockKeyhole } from "lucide-react";
import { PageHeading } from "../../components/shared.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs.js";
import { SecuritySettings } from "../settings/security-settings.js";
import { PasswordSettings, RecoverySettings } from "./security.js";

export function Profile({ email }: { email: string }) {
  return (
    <div className="max-w-3xl min-w-0">
      <PageHeading
        title="Profile"
        description="A little care for the account behind every message."
      />
      <div className="mb-7 rounded-xl border bg-primary/5 px-5 py-4">
        <p className="text-xs text-muted-foreground mb-1">Signed in as</p>
        <p className="text-sm font-medium break-all">{email}</p>
      </div>
      <Tabs defaultValue="security" className="gap-7">
        <TabsList aria-label="Profile sections">
          <TabsTrigger value="security" className="min-h-10 px-4">
            <LockKeyhole />
            Security
          </TabsTrigger>
        </TabsList>
        <TabsContent value="security" className="space-y-6">
          <PasswordSettings />
          <RecoverySettings email={email} />
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
