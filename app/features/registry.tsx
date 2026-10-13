import { Link } from "react-router";
import { Heart, ArrowUpRight } from "lucide-react";
import { localize } from "../config/schema";
import { tr } from "../i18n";
import { Button } from "../components/ui";
import type { FeatureViewProps } from "./types";
export default function Registry({ data, action }: FeatureViewProps) {
  const { config, locale, household } = data;
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  return (
    <>
      <p className="intro">{tr(locale, "registryHelp")}</p>
      <div className="registry-grid">
        {config.registry.map((item) => {
          const reservation = data.reservations.find(
              (r) => r.item_id === item.id,
            ),
            remaining =
              item.quantity -
              (data.counts.find((c) => c.item_id === item.id)?.total || 0);
          return (
            <article className="card" key={item.id}>
              <div className="gift-icon">
                <Heart />
              </div>
              <h2>{l(item.title)}</h2>
              <p>{l(item.description)}</p>
              <a
                className="text-link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {tr(locale, "viewLink")}
                <ArrowUpRight size={16} />
              </a>
              {item.kind === "gift" && (
                <div className="gift-actions">
                  <small>
                    {remaining} {tr(locale, "remaining")}
                  </small>
                  {reservation ? (
                    <>
                      <p>
                        {tr(
                          locale,
                          reservation.status === "purchased"
                            ? "purchased"
                            : "reserved",
                        )}
                      </p>
                      {reservation.status === "reserved" && (
                        <Button
                          onClick={() =>
                            void action("/registry/update", {
                              id: reservation.id,
                              status: "purchased",
                            })
                          }
                        >
                          {tr(locale, "purchased")}
                        </Button>
                      )}
                      <Button
                        className="secondary"
                        onClick={() =>
                          void action("/registry/update", {
                            id: reservation.id,
                            status: "cancelled",
                          })
                        }
                      >
                        {tr(locale, "cancel")}
                      </Button>
                    </>
                  ) : household ? (
                    <Button
                      disabled={remaining <= 0}
                      onClick={() =>
                        void action("/registry/reserve", { itemId: item.id })
                      }
                    >
                      {tr(locale, "reserve")}
                    </Button>
                  ) : (
                    <Link className="button secondary" to={`/${locale}/rsvp`}>
                      {tr(locale, "unlock")}
                    </Link>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
