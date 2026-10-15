import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WebStorageMode } from "@shared/webStorage";
import {
  currentWebStorageMode,
  switchWebStorageMode,
  webStorageContext,
} from "@renderer/lib/web/storageContext";
import { Field } from "../ui/Field";
import { Select } from "../ui/Select";
import { Button } from "../common/Button";

export function WebStorageSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const [active, setActive] = useState<WebStorageMode>(currentWebStorageMode());
  const [selected, setSelected] = useState<WebStorageMode>(active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void webStorageContext()
      .then((context) => {
        if (mounted) {
          setActive(context.mode);
          setSelected(context.mode);
        }
      })
      .catch((failure: unknown) => {
        if (mounted)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
  const apply = async (): Promise<void> => {
    if (!window.confirm(t("webStorage.switchConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      await switchWebStorageMode(selected);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };
  return (
    <>
      <Field label={t("webStorage.mode")} hint={t("webStorage.modeHint")}>
        <Select<WebStorageMode>
          value={selected}
          onChange={setSelected}
          disabled={busy}
          aria-label={t("webStorage.mode")}
          options={[
            { value: "server", label: t("webStorage.server") },
            { value: "browser", label: t("webStorage.browser") },
          ]}
        />
      </Field>
      <p className="hint">
        {t(
          selected === "server"
            ? "webStorage.serverDescription"
            : "webStorage.browserDescription",
        )}
      </p>
      <p className="hint">{t("webStorage.switchHint")}</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        disabled={selected === active}
        busy={busy}
        onClick={() => void apply()}
      >
        {t("webStorage.apply")}
      </Button>
    </>
  );
}
