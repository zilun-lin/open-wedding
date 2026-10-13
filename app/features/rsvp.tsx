import { useState } from "react";
import { useRevalidator } from "react-router";
import { localize, formatDate } from "../config/schema";
import { tr } from "../i18n";
import { Button, Field, Notice, api } from "../components/ui";
import type { FeatureViewProps } from "./types";
export default function Rsvp({ data }: FeatureViewProps) {
  const { config, locale, household, guests, invited } = data;
  const events = config.events.filter((e) => e.rsvp && invited.includes(e.id)),
    revalidator = useRevalidator();
  const [answers, setAnswers] = useState(() =>
      guests.flatMap((guest) =>
        events.map((event) => {
          const old = data.answers.find(
            (a) => a.guest_id === guest.id && a.event_id === event.id,
          );
          return {
            guestId: guest.id,
            eventId: event.id,
            attending: old ? Boolean(old.attending) : undefined,
            meal: old?.meal || "",
            dietary: old?.dietary || "",
            accessibility: old?.accessibility || "",
            transport: old?.transport || "",
          };
        }),
      ),
    ),
    [email, setEmail] = useState(household?.email || ""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (index: number, key: string, value: unknown) =>
    setAnswers((all) =>
      all.map((a, i) => (i === index ? { ...a, [key]: value } : a)),
    );
  if (!events.length) return <Notice>{tr(locale, "invalidInvitation")}</Notice>;
  return (
    <form
      className="rsvp-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNotice("");
        try {
          await api("/rsvp", {
            submissionId: crypto.randomUUID(),
            revision: household!.revision,
            email,
            locale,
            answers,
          });
          setNotice("saved");
          revalidator.revalidate();
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "serverError");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="intro">{tr(locale, "rsvpHelp")}</p>
      <p className="deadline">
        {tr(locale, "deadline")}:{" "}
        {formatDate(config.rsvpDeadline, locale, config.timeZone)}
      </p>
      {answers.map((answer, index) => (
        <fieldset className="card" key={`${answer.guestId}-${answer.eventId}`}>
          <legend>
            {guests.find((g) => g.id === answer.guestId)?.name} ·{" "}
            {localize(
              events.find((e) => e.id === answer.eventId)!.name,
              locale,
            )}
          </legend>
          <label className="field">
            <span>{tr(locale, "rsvp")}</span>
            <select
              required
              value={
                answer.attending === undefined
                  ? ""
                  : answer.attending
                    ? "yes"
                    : "no"
              }
              onChange={(e) =>
                update(index, "attending", e.target.value === "yes")
              }
            >
              <option value="">{tr(locale, "choose")}</option>
              <option value="yes">{tr(locale, "yes")}</option>
              <option value="no">{tr(locale, "no")}</option>
            </select>
          </label>
          {answer.attending && (
            <div className="form-grid">
              {(["meal", "dietary", "accessibility", "transport"] as const).map(
                (key) => (
                  <Field
                    key={key}
                    label={tr(locale, key)}
                    maxLength={
                      key === "meal" || key === "transport" ? 100 : 500
                    }
                    value={answer[key]}
                    onChange={(e) => update(index, key, e.target.value)}
                  />
                ),
              )}
            </div>
          )}
        </fieldset>
      ))}
      <Field
        label={tr(locale, "email")}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button disabled={busy || Date.now() > Date.parse(config.rsvpDeadline)}>
        {tr(locale, busy ? "loading" : "submitRsvp")}
      </Button>
      {notice && (
        <Notice error={notice !== "saved"}>{tr(locale, notice)}</Notice>
      )}
    </form>
  );
}
