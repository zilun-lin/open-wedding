import { ArrowUpRight } from "lucide-react";
import { localize, formatDate } from "../config/schema";
import { tr } from "../i18n";
import type { FeatureViewProps } from "./types";
export default function Timeline({ data, action }: FeatureViewProps) {
  const { config, locale } = data;
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  const date = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatDate(value, locale, config.timeZone, options);
  return (
    <div className="timeline">
      {config.events.map((event, i) => (
        <article key={event.id}>
          <div className="timeline-time">
            <span>{date(event.startsAt, { timeStyle: "short" })}</span>
            <small>{date(event.startsAt, { dateStyle: "medium" })}</small>
          </div>
          <div className="timeline-body">
            <span className="eyebrow">0{i + 1}</span>
            <h2>{l(event.name)}</h2>
            <p>{l(event.description)}</p>
            <p className="muted">
              {l(event.venue.name)} · {l(event.venue.address)}
            </p>
            <a
              className="text-link"
              href={`/calendar/${locale}/${event.id}.ics`}
            >
              {tr(locale, "addCalendar")}
              <ArrowUpRight size={16} />
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
