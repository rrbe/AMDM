import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Input } from "../ui/Input";
import { Field } from "../ui/Field";
import {
  answerPasswordPrompt,
  pendingPasswordPrompt,
  subscribePasswordPrompt,
} from "@renderer/lib/web/passwordPrompt";

export function WebPasswordPrompt(): React.JSX.Element | null {
  const pending = useSyncExternalStore(
    subscribePasswordPrompt,
    pendingPasswordPrompt,
  );
  return pending ? (
    <PasswordForm key={pending.id} name={pending.connection.name} />
  ) : null;
}

function PasswordForm({ name }: { name: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  return (
    <Modal
      title={t("webStorage.passwordTitle")}
      description={t("webStorage.passwordDescription", { name })}
      size="sm"
      onClose={() => answerPasswordPrompt(null)}
      footer={
        <>
          <Button onClick={() => answerPasswordPrompt(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="web-connection-password"
          >
            {t("webStorage.connect")}
          </Button>
        </>
      }
    >
      <form
        id="web-connection-password"
        onSubmit={(event) => {
          event.preventDefault();
          answerPasswordPrompt(password);
        }}
      >
        <Field label={t("connection.auth.password")}>
          <Input
            type="password"
            autoComplete="off"
            aria-label={t("connection.auth.password")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </Field>
        <p className="hint">{t("webStorage.browserPasswordHint")}</p>
      </form>
    </Modal>
  );
}
