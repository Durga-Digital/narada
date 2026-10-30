import { copyWithFeedback } from "../../lib/feedback.js";
import { useState } from "react";
import { Code2, Copy, Check } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { PageHeading } from "../../components/shared.js";
import { examples, resources, snippet, type ApiResource } from "./examples.js";
function Examples({ resource }: { resource: ApiResource }) {
  const [language, setLanguage] = useState<"Node.js" | "cURL">("Node.js");
  const [copied, setCopied] = useState(""),
    [error, setError] = useState("");
  return (
    <>
      <div aria-label="Code language" className="flex gap-2 my-5">
        {(["Node.js", "cURL"] as const).map((l) => (
          <Button
            key={l}
            variant={l === language ? "secondary" : "ghost"}
            aria-pressed={l === language}
            onClick={() => {
              setLanguage(l);
              setCopied("");
            }}
          >
            {l}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        {resource === "Emails"
          ? "Use Sending access, Full access, or a scoped key with emails:send."
          : resource === "Contacts"
            ? "Use contacts:create for signup-only creation, contacts:read for listing and retrieval, contacts:write for individual create/get/update, or contacts:subscriptions for consent changes."
            : resource === "Segments"
              ? "Choose segments:read, segments:write, segments:members, or segments:import for the operations your app needs."
              : resource === "Templates"
                ? "Choose templates:read, templates:write, or templates:test. Creating a broadcast from a template requires templates:read and broadcasts:write."
                : resource === "Broadcasts"
                  ? "Choose broadcasts:read, broadcasts:write, or broadcasts:send. Sending access alone does not grant broadcast access."
                  : resource === "Topics"
                    ? "Choose topics:read or topics:write. Contact subscription changes use contacts:subscriptions."
                    : "Choose properties:read or properties:write for contact property definitions."}{" "}
        Edit an existing key in API keys to change its scopes without replacing
        its token. Keep it on your server. Replace example IDs, addresses, and
        revisions with your own.
      </p>
      {language === "Node.js" && (
        <p className="text-sm text-muted-foreground mb-5">
          Install the SDK with <code>npm install @durgadigital/narada</code>.
          Requires Node.js 22+ and ESM.
        </p>
      )}
      <p role="status" className="text-sm">
        {error}
      </p>
      <div className="space-y-8">
        {examples[resource].map((example) => {
          const code = snippet(example, language, location.origin);
          return (
            <section key={example.title}>
              <div className="flex items-center justify-between gap-4 mb-2">
                <h3 className="font-medium">{example.title}</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Copy ${example.title}`}
                  onClick={async () => {
                    try {
                      await copyWithFeedback(code);
                      setCopied(example.title);
                      setError("");
                    } catch {
                      setError(
                        "Could not copy. Select and copy the code below.",
                      );
                    }
                  }}
                >
                  {copied === example.title ? <Check /> : <Copy />}
                  {copied === example.title ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-3 break-all">
                {example.method} /api/v1{example.path}
              </p>
              <pre
                className="bg-[#223429] text-[#dfebd6] rounded-xl p-5 overflow-x-auto text-xs leading-6"
                tabIndex={0}
              >
                <code>{code}</code>
              </pre>
              {example.note && (
                <p className="text-sm text-muted-foreground mt-3">
                  {example.note}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
export function ApiPanel({ resource }: { resource: ApiResource }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={`${resource} API`}
          title={`${resource} API`}
        >
          <Code2 />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-auto right-0 top-0 translate-x-0 translate-y-0 h-dvh data-[state=open]:animate-none data-[state=closed]:animate-none max-w-full sm:max-w-2xl rounded-none overflow-y-auto block p-6">
        <DialogHeader>
          <DialogTitle>{resource} API</DialogTitle>
          <DialogDescription>
            Use Narada programmatically with Node.js or cURL.
          </DialogDescription>
        </DialogHeader>
        <Examples resource={resource} />
      </DialogContent>
    </Dialog>
  );
}
export function ApiReference() {
  const [resource, setResource] = useState<ApiResource>("Emails");
  return (
    <>
      <PageHeading
        title="Build with Narada."
        description="Versioned APIs and a typed Node.js SDK for your application."
      />
      <nav aria-label="API resources" className="flex flex-wrap gap-1 mb-5">
        {resources.map((r) => (
          <Button
            key={r}
            variant={resource === r ? "secondary" : "ghost"}
            aria-current={resource === r ? "page" : undefined}
            onClick={() => setResource(r)}
          >
            {r}
          </Button>
        ))}
      </nav>
      <div className="max-w-4xl">
        <Examples key={resource} resource={resource} />
      </div>
    </>
  );
}
