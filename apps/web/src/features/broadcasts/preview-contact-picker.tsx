import { useResource } from "../../hooks/use-resource.js";
import { Field, Notice } from "../../components/shared.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import type { AudienceDetail } from "./types.js";
export function PreviewContactPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (email: string) => void;
}) {
  const resource = useResource<AudienceDetail>(`audiences/${id}`);
  return (
    <div>
      <Field label="Preview as contact">
        <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">First eligible contact</option>
          {resource.data?.contacts.map((c) => (
            <option key={c.email} value={c.email}>
              {c.name ? `${c.name} · ` : ""}
              {c.email}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Notice>{resource.error}</Notice>
    </div>
  );
}
