import { api, type Key } from "../../lib/api.js";
import { ConfirmRemovalDialog } from "../../components/confirm-removal-dialog.js";
export function RevokeKeyDialog({
  apiKey,
  close,
  revoked,
}: {
  apiKey: Key;
  close: () => void;
  revoked: (key: Key) => void;
}) {
  return (
    <ConfirmRemovalDialog
      title="Revoke API key?"
      name={apiKey.name}
      action="Revoke key"
      successMessage="API key revoked"
      close={close}
      description="Applications using this key will no longer be able to authenticate new requests. Queued emails continue. This cannot be undone; the key stays in the list until you delete it."
      perform={(confirmation) =>
        api(`keys/${apiKey.id}/revoke`, { confirmation })
      }
      completed={() => {
        revoked({ ...apiKey, revoked: true });
        close();
      }}
    />
  );
}
