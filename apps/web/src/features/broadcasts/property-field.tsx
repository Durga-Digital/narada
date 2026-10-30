import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import type { PropertyDefinition } from "./types.js";
export function propertyInputValue(
  type: PropertyDefinition["type"],
  value: string,
) {
  return type === "number"
    ? Number(value)
    : type === "boolean"
      ? value === "true"
      : value;
}
export function PropertyField({
  type,
  value,
  onChange,
  id,
}: {
  type: PropertyDefinition["type"];
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  if (type === "boolean")
    return (
      <NativeSelect
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Not set</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </NativeSelect>
    );
  return (
    <Input
      id={id}
      type={type === "date" ? "date" : type === "number" ? "number" : "text"}
      step="any"
      maxLength={500}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
