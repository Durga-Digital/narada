import { ApiPanel } from "../api-reference/api-reference.js";
import type { ApiResource } from "../api-reference/examples.js";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import { ContactDirectoryPage } from "./contact-directory.js";
import { PropertiesPage, TopicsPage } from "./metadata-pages.js";
import { SegmentsPage } from "./segments-page.js";
export function Audiences() {
  const [tab, setTab] = useState("Contacts");
  const navigation = (
    <nav aria-label="Audience sections" className="flex flex-wrap gap-1">
      {["Contacts", "Properties", "Segments", "Topics"].map((name) => (
        <Button
          key={name}
          variant={tab === name ? "secondary" : "ghost"}
          aria-current={tab === name ? "page" : undefined}
          onClick={() => setTab(name)}
        >
          {name}
        </Button>
      ))}
      <div className="ml-auto">
        <ApiPanel resource={tab as ApiResource} />
      </div>
    </nav>
  );
  return tab === "Contacts" ? (
    <ContactDirectoryPage navigation={navigation} />
  ) : tab === "Properties" ? (
    <PropertiesPage navigation={navigation} />
  ) : tab === "Segments" ? (
    <SegmentsPage navigation={navigation} />
  ) : (
    <TopicsPage navigation={navigation} />
  );
}
