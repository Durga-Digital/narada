import { Inspector } from "@react-email/editor/ui";
import { Field } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
export function DocumentStyle() {
  return (
    <Inspector.Document>
      {({ findStyleValue, setGlobalStyle }) => (
        <div className="grid gap-4 pt-4">
          <Field label="Page background">
            <Input
              type="color"
              className="h-9 p-1 cursor-pointer"
              value={String(
                findStyleValue("body", "backgroundColor") || "#ffffff",
              )}
              onChange={(e) =>
                setGlobalStyle("body", "backgroundColor", e.target.value)
              }
            />
          </Field>
          <Field label="Message background">
            <Input
              type="color"
              className="h-9 p-1 cursor-pointer"
              value={String(
                findStyleValue("container", "backgroundColor") || "#ffffff",
              )}
              onChange={(e) =>
                setGlobalStyle("container", "backgroundColor", e.target.value)
              }
            />
          </Field>
          <Field label="Message width (px)">
            <Input
              type="number"
              min={320}
              max={800}
              value={
                Number.parseInt(String(findStyleValue("container", "width"))) ||
                600
              }
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (n >= 320 && n <= 800)
                  setGlobalStyle("container", "width", n);
              }}
            />
          </Field>
          <Field label="Message padding (px)">
            <Input
              type="number"
              min={0}
              max={80}
              value={
                Number.parseInt(
                  String(findStyleValue("container", "padding")),
                ) || 0
              }
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (n >= 0 && n <= 80)
                  setGlobalStyle("container", "padding", n);
              }}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Select a block or text to adjust its style. Click Body above to
            return to page settings.
          </p>
        </div>
      )}
    </Inspector.Document>
  );
}
