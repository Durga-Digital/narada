import type { TemplateVariable } from "@narada/core/template-model";
import { Field } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
export type SampleValues = Record<string, string | number | boolean>;
export function SampleValuesForm({
  definitions,
  value,
  onChange,
}: {
  definitions: TemplateVariable[];
  value: SampleValues;
  onChange: (value: SampleValues) => void;
}) {
  function change(key: string, next: string | number | boolean | undefined) {
    const updated = { ...value };
    if (next === undefined) delete updated[key];
    else updated[key] = next;
    onChange(updated);
  }
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {definitions
        .filter((v) => v.key)
        .map((variable) => (
          <Field key={variable.key} label={`Sample ${variable.key}`}>
            {variable.type === "boolean" ? (
              <NativeSelect
                value={
                  value[variable.key] === undefined
                    ? ""
                    : String(value[variable.key])
                }
                onChange={(e) =>
                  change(
                    variable.key,
                    e.target.value === ""
                      ? undefined
                      : e.target.value === "true",
                  )
                }
              >
                <option value="">
                  {variable.fallback === undefined
                    ? "Choose a value"
                    : `Default: ${variable.fallback}`}
                </option>
                <option value="true">true</option>
                <option value="false">false</option>
              </NativeSelect>
            ) : (
              <Input
                type={variable.type === "number" ? "number" : "text"}
                value={String(value[variable.key] ?? "")}
                placeholder={
                  variable.fallback === undefined
                    ? "Required for preview and test"
                    : `Default: ${variable.fallback}`
                }
                onChange={(e) =>
                  change(
                    variable.key,
                    e.target.value === ""
                      ? undefined
                      : variable.type === "number"
                        ? e.target.valueAsNumber
                        : e.target.value,
                  )
                }
              />
            )}
          </Field>
        ))}
    </div>
  );
}
