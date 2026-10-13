import { localize, formatDate } from "../config/schema";
import { tr } from "../i18n";
import { Notice } from "../components/ui";
import type { FeatureViewProps } from "./types";
export default function Seating({ data, action }: FeatureViewProps) {
  const { config, locale } = data;
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  const date = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatDate(value, locale, config.timeZone, options);
  return (
    <>
      <p className="intro">{tr(locale, "seatingHelp")}</p>
      {Date.now() < Date.parse(config.seatingReleaseAt) ? (
        <Notice>
          {tr(locale, "released")}:{" "}
          {date(config.seatingReleaseAt, {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </Notice>
      ) : data.seats.length ? (
        <div className="details-grid">
          {data.seats.map((seat) => (
            <div className="card" key={`${seat.name}-${seat.event_id}`}>
              <p className="eyebrow">
                {l(
                  config.events.find((e) => e.id === seat.event_id)?.name || {},
                )}
              </p>
              <h2>{seat.name}</h2>
              <p>
                {tr(locale, "table")} <strong>{seat.table_name}</strong>
              </p>
            </div>
          ))}
        </div>
      ) : (
        <Notice>{tr(locale, "unassigned")}</Notice>
      )}
    </>
  );
}
