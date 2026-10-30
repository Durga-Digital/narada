import { Cloud, Send, ShieldCheck } from "lucide-react";
import { PageHeading } from "../../components/shared.js";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs.js";
import { SesSettings } from "./ses-settings.js";
import { SendingSettings } from "./sending-settings.js";
import { RecipientSettings } from "./recipient-settings.js";
const sections = [
  { value: "ses", label: "Amazon SES", icon: Cloud, component: SesSettings },
  {
    value: "sending",
    label: "Sending",
    icon: Send,
    component: SendingSettings,
  },
  {
    value: "recipients",
    label: "Recipients",
    icon: ShieldCheck,
    component: RecipientSettings,
  },
];
export function Settings() {
  return (
    <div className="min-w-0">
      <PageHeading
        title="Settings"
        description="Your infrastructure and delivery preferences. All in one place."
      />
      <Tabs defaultValue="ses" className="gap-7">
        <TabsList
          aria-label="Settings sections"
          className="grid w-full sm:w-fit grid-cols-1 sm:grid-cols-3 h-auto! gap-1 p-1"
        >
          {sections.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="min-h-10 px-4">
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map(({ value, component: Component }) => (
          <TabsContent
            key={value}
            value={value}
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <Component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
