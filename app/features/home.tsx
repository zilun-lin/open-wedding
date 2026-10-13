import { Link } from "react-router";
import { Heart, ArrowUpRight, MapPin, CalendarDays } from "lucide-react";
import { localize, formatDate } from "../config/schema";
import { tr } from "../i18n";
import type { FeatureViewProps } from "./types";
export default function Home({ data }: FeatureViewProps) {
  const { config, locale } = data;
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  const date = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatDate(value, locale, config.timeZone, options);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            {date(config.celebrationAt)} · {l(config.venue.name)}
          </p>
          <h1>
            {config.partners.map((partner, i) => (
              <span key={i}>
                {i === 1 && <em>& </em>}
                {l(partner.name)}
              </span>
            ))}
          </h1>
          <p className="hero-intro">{l(config.welcome)}</p>
          <div className="hero-actions">
            {config.features.rsvp && (
              <Link className="button" to={`/${locale}/rsvp`}>
                {tr(locale, "respond")}
                <ArrowUpRight size={17} />
              </Link>
            )}
            <Link className="text-link" to={`/${locale}/timeline`}>
              {tr(locale, "viewDay")}
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <span className="hero-caption">{tr(locale, "celebration")}</span>
        </div>
        <div className="garden" aria-hidden="true">
          <div className="garden-arch">
            <svg viewBox="0 0 400 500">
              <path
                d="M80 510 Q140 280 100 130 M100 350 Q10 280 55 235 Q130 230 115 300 M110 250 Q200 220 190 170 Q115 130 105 225 M115 170 Q80 90 95 40 M280 510 Q245 290 290 150 M275 350 Q355 325 360 260 Q280 240 270 325 M283 245 Q210 215 215 160 Q280 140 285 220"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              <g fill="currentColor" opacity=".35">
                <ellipse
                  cx="97"
                  cy="135"
                  rx="25"
                  ry="45"
                  transform="rotate(-25 97 135)"
                />
                <ellipse
                  cx="293"
                  cy="149"
                  rx="28"
                  ry="45"
                  transform="rotate(20 293 149)"
                />
                <ellipse
                  cx="155"
                  cy="400"
                  rx="42"
                  ry="23"
                  transform="rotate(-40 155 400)"
                />
              </g>
              <g fill="var(--petal)">
                <circle cx="191" cy="172" r="22" />
                <circle cx="202" cy="147" r="22" />
                <circle cx="221" cy="166" r="22" />
                <circle cx="214" cy="193" r="22" />
                <circle cx="185" cy="197" r="22" />
              </g>
              <circle cx="204" cy="175" r="13" fill="var(--accent)" />
            </svg>
            <div className="garden-note">
              {tr(locale, "joinUs")}
              <Heart size={16} />
            </div>
          </div>
        </div>
      </section>
      <section className="story-section">
        <p className="eyebrow">{tr(locale, "ourStory")}</p>
        <h2>{tr(locale, "joinUs")}</h2>
        <p>{l(config.story)}</p>
      </section>
      <section className="details-grid">
        <div className="card">
          <CalendarDays />
          <p className="eyebrow">{tr(locale, "when")}</p>
          <h3>{date(config.celebrationAt)}</h3>
          <p>
            {date(config.celebrationAt, { timeStyle: "short" })} ·{" "}
            {config.timeZone}
          </p>
        </div>
        <div className="card">
          <MapPin />
          <p className="eyebrow">{tr(locale, "where")}</p>
          <h3>{l(config.venue.name)}</h3>
          <p>{l(config.venue.address)}</p>
          <Link className="text-link" to={`/${locale}/travel`}>
            {tr(locale, "travel")}
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>
    </>
  );
}
