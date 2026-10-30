import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field } from "../../components/shared.js";
import type { TemplateVariable } from "@narada/core/template-model";
export function Variables({
  value,
  onChange,
  disabled,
}: {
  value: TemplateVariable[];
  onChange: (value: TemplateVariable[]) => void;
  disabled: boolean;
}) {
  const change = (index: number, patch: Partial<TemplateVariable>) =>
    onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Variables</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.length >= 30}
          onClick={() => onChange([...value, { key: "", type: "string" }])}
        >
          Add variable
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Use {"{{vars.key}}"} in your message. Values are escaped and checked
        before sending. URL variables can fill an entire quoted link href in
        source HTML.
      </p>
      {value.map((variable, i) => (
        <div
          key={i}
          className="grid sm:grid-cols-[1fr_130px_1fr_auto] gap-3 items-end border rounded-lg p-3"
        >
          <Field label={`Variable ${i + 1} key`}>
            <Input
              value={variable.key}
              onChange={(e) => change(i, { key: e.target.value })}
            />
          </Field>
          <Field label={`Variable ${i + 1} type`}>
            <NativeSelect
              value={variable.type}
              onChange={(e) =>
                change(i, {
                  type: e.target.value as TemplateVariable["type"],
                  fallback: undefined,
                })
              }
            >
              {["string", "number", "boolean", "url"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={`Variable ${i + 1} fallback`}>
            {variable.type === "boolean" ? (
              <NativeSelect
                value={
                  variable.fallback === undefined
                    ? ""
                    : String(variable.fallback)
                }
                onChange={(e) =>
                  change(i, {
                    fallback:
                      e.target.value === ""
                        ? undefined
                        : e.target.value === "true",
                  })
                }
              >
                <option value="">Required at send</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </NativeSelect>
            ) : (
              <Input
                type={variable.type === "number" ? "number" : "text"}
                value={
                  variable.fallback === undefined
                    ? ""
                    : String(variable.fallback)
                }
                placeholder="Required at send"
                onChange={(e) =>
                  change(i, {
                    fallback:
                      e.target.value === ""
                        ? undefined
                        : variable.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                  })
                }
              />
            )}
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove variable ${i + 1}`}
            onClick={() => onChange(value.filter((_, index) => index !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </fieldset>
  );
}
