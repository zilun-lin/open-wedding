import { useState } from "react";
import { useRevalidator } from "react-router";
import { tr } from "../i18n";
import { Button, Field, Notice, api } from "./ui";
export function Invitation({ locale }: { locale: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revalidator = useRevalidator();
  async function unlock(value: string) {
    setBusy(true);
    setError("");
    try {
      await api("/invitation", { code: value });
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card narrow">
      <p className="eyebrow">{tr(locale, "invitation")}</p>
      <h2>{tr(locale, "respond")}</h2>
      <p>{tr(locale, "invitationHelp")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void unlock(code);
        }}
      >
        <Field
          label={tr(locale, "code")}
          required
          minLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
        />
        <Button disabled={busy}>
          {tr(locale, busy ? "loading" : "unlock")}
        </Button>
      </form>
      {error && <Notice error>{tr(locale, error)}</Notice>}
      <small>{tr(locale, "privacy")}</small>
    </section>
  );
}
