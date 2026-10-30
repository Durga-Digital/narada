import { Approvals } from "./features/approvals/approvals.js";
import { Activity } from "./features/activity/activity.js";
import { Newsletters } from "./features/newsletters/newsletters.js";
import { Forms } from "./features/forms/forms.js";
import { Metrics } from "./features/metrics/metrics.js";
import { Templates } from "./features/templates/templates.js";
import { ApiReference } from "./features/api-reference/api-reference.js";
import { IntegrationGuide } from "./features/integration/integration-guide.js";
import { useRef, useState } from "react";
import {
  ChartNoAxesCombined,
  Send,
  Mail,
  Globe,
  KeyRound,
  Webhook,
  Settings2,
  BookOpen,
  LogOut,
  ArrowUpRight,
  Radio,
  LayoutTemplate,
  Users,
  ClipboardList,
  Plug,
  Menu,
  UserRound,
} from "lucide-react";
import { authClient } from "./lib/auth.js";
import { Button } from "./components/ui/button.js";
import { Login } from "./features/auth/login.js";
import { Emails } from "./features/emails/emails.js";
import { Domains } from "./features/domains/domains.js";
import { Keys } from "./features/keys/keys.js";
import { Webhooks } from "./features/webhooks/webhooks.js";
import { Profile } from "./features/profile/profile.js";
import { Settings } from "./features/settings/settings.js";
import { Broadcasts } from "./features/broadcasts/broadcasts.js";
import { Audiences } from "./features/broadcasts/audiences.js";
const navigationSections = [
  {
    id: "publishing",
    label: "Publish & grow",
    items: [
      { id: "newsletters", label: "Newsletters", icon: BookOpen },
      { id: "forms", label: "Forms", icon: ClipboardList },
      { id: "broadcasts", label: "Broadcasts", icon: Radio },
      { id: "templates", label: "Templates", icon: LayoutTemplate },
      { id: "audiences", label: "Audience", icon: Users },
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    items: [
      { id: "emails", label: "Emails", icon: Mail },
      { id: "approvals", label: "Send approvals", icon: ClipboardList },
      { id: "activity", label: "Activity", icon: ClipboardList },
      { id: "metrics", label: "Metrics", icon: ChartNoAxesCombined },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      { id: "domains", label: "Domains", icon: Globe },
      { id: "keys", label: "API keys", icon: KeyRound },
      { id: "webhooks", label: "Webhooks", icon: Webhook },
      { id: "docs", label: "API reference", icon: BookOpen },
      { id: "integrate", label: "Integrate an app", icon: Plug },
      { id: "settings", label: "Settings", icon: Settings2 },
      { id: "profile", label: "Profile", icon: UserRound },
    ],
  },
] as const;
type Page = (typeof navigationSections)[number]["items"][number]["id"];
export function App() {
  const { data: session, isPending } = authClient.useSession();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<Page>(() => {
    const requested = new URLSearchParams(location.search).get("page");
    for (const section of navigationSections)
      for (const item of section.items)
        if (item.id === requested) return item.id;
    return "emails";
  });
  const activeSection = navigationSections.find((section) =>
    section.items.some((item) => item.id === page),
  );
  const activePage = activeSection?.items.find((item) => item.id === page);
  if (isPending)
    return (
      <div role="status" className="p-12 text-muted-foreground">
        Opening your delivery room…
      </div>
    );
  if (!session || new URLSearchParams(location.search).has("token"))
    return <Login />;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[224px_1fr]">
      <aside className="border-r bg-[#f3f5ef] flex flex-col md:sticky md:top-0 md:h-screen md:overflow-y-auto p-5">
        <a
          href="/"
          className="flex items-center gap-3 px-2 py-2 md:py-4 md:mb-6"
        >
          <Send className="text-primary" size={25} />
          <span className="serif text-3xl">
            narada<span className="text-primary">.</span>
          </span>
        </a>
        <div className="hidden md:block rounded-lg border bg-white/60 p-3 mb-6 text-xs">
          <p className="font-medium">Personal workspace</p>
          <p className="text-muted-foreground mt-1">Email workspace</p>
        </div>
        <Button
          ref={navigationToggle}
          variant="ghost"
          className="md:hidden justify-between mt-2"
          aria-expanded={navigationOpen}
          aria-controls="main-navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <span className="flex items-center gap-2">
            <Menu size={17} aria-hidden="true" />
            Navigation
          </span>
          <span className="text-muted-foreground">{activePage?.label}</span>
        </Button>
        <nav
          id="main-navigation"
          aria-label="Main navigation"
          className={`${navigationOpen ? "flex" : "hidden"} md:flex flex-col shrink-0 gap-6 mt-5 md:mt-0`}
        >
          {navigationSections.map((section) => (
            <section key={section.id} aria-labelledby={`nav-${section.id}`}>
              <h2
                id={`nav-${section.id}`}
                className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {section.label}
              </h2>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <Button
                      variant="ghost"
                      aria-current={page === item.id ? "page" : undefined}
                      className={`w-full justify-start gap-3 h-10 ${page === item.id ? "bg-[#e3ebdc] text-primary" : ""}`}
                      onClick={() => {
                        setPage(item.id);
                        if (navigationOpen) navigationToggle.current?.focus();
                        setNavigationOpen(false);
                      }}
                    >
                      <item.icon size={17} aria-hidden="true" />
                      {item.label}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="mt-auto pt-8 hidden md:block">
          <p className="text-xs text-muted-foreground px-2 mb-4">
            A good message finds its way.
          </p>
          <div className="border-t pt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Open profile"
              onClick={() => setPage("profile")}
              className="min-w-0 overflow-hidden text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs font-medium truncate">
                {session.user.name}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {session.user.email}
              </p>
            </button>
            <Button
              aria-label="Sign out"
              variant="ghost"
              size="icon"
              onClick={async () => {
                await authClient.signOut();
                location.href = "/";
              }}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="h-16 border-b px-6 md:px-10 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            <span className="hidden sm:inline">
              {activeSection?.label}
              <span className="mx-3 text-border">/</span>
            </span>
            <span className="text-foreground">{activePage?.label}</span>
          </span>
          <span className="flex gap-2 items-center text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Self-hosted · yours to keep
          </span>
        </header>
        <main className="max-w-7xl mx-auto p-6 md:p-10 lg:p-12">
          {page === "emails" ? (
            <Emails />
          ) : page === "newsletters" ? (
            <Newsletters />
          ) : page === "broadcasts" ? (
            <Broadcasts />
          ) : page === "audiences" ? (
            <Audiences />
          ) : page === "forms" ? (
            <Forms />
          ) : page === "templates" ? (
            <Templates />
          ) : page === "approvals" ? (
            <Approvals />
          ) : page === "activity" ? (
            <Activity />
          ) : page === "metrics" ? (
            <Metrics />
          ) : page === "domains" ? (
            <Domains />
          ) : page === "keys" ? (
            <Keys />
          ) : page === "webhooks" ? (
            <Webhooks />
          ) : page === "profile" ? (
            <Profile email={session.user.email} />
          ) : page === "settings" ? (
            <Settings />
          ) : page === "integrate" ? (
            <IntegrationGuide />
          ) : (
            <ApiReference />
          )}
        </main>
        <footer className="px-10 pb-6 text-[11px] text-muted-foreground flex justify-between">
          <span>NARADA · A clear path for every message</span>
          <span className="flex items-center gap-1">
            Built on your terms
            <ArrowUpRight size={12} />
          </span>
        </footer>
      </div>
    </div>
  );
}
