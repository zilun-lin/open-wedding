import { ArrowUpRight } from "lucide-react";
import { localize } from "../config/schema";
import { tr } from "../i18n";
import type { FeatureViewProps } from "./types";
export default function Travel({ data, action }: FeatureViewProps) {
  const { config, locale } = data;
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  return (
    <>
      <div className="card">
        <h2>{l(config.venue.name)}</h2>
        <p>{l(config.venue.address)}</p>
        <p>{l(config.venue.directions)}</p>
        {config.venue.mapUrl && (
          <a
            className="text-link"
            href={config.venue.mapUrl}
            target="_blank"
            rel="noreferrer"
          >
            {tr(locale, "directions")}
            <ArrowUpRight size={16} />
          </a>
        )}
      </div>
      <div className="details-grid">
        {config.travel.map((item) => (
          <article className="card" key={item.id}>
            <h2>{l(item.title)}</h2>
            <p>{l(item.text)}</p>
            {item.url && (
              <a
                className="text-link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {tr(locale, "viewLink")}
                <ArrowUpRight size={16} />
              </a>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
