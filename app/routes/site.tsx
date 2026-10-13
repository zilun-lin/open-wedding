import Rsvp from "../features/rsvp";
import Memories from "../features/memories";
import Registry from "../features/registry";
import Seating from "../features/seating";
import Faq from "../features/faq";
import Travel from "../features/travel";
import Timeline from "../features/timeline";
import Home from "../features/home";
import { useEffect, useState } from "react";
import {
  Link,
  useLoaderData,
  useRevalidator,
  useLocation,
  type LoaderFunctionArgs,
  redirect,
} from "react-router";
import { Menu, X, Flower2 } from "lucide-react";
import { platformContext } from "../platform/context";
import {
  getConfig,
  invitedEvents,
  visibleConfig,
} from "../platform/config.server";
import { guestSession } from "../platform/security.server";
import { enabledModules } from "../config/modules";
import { localize } from "../config/schema";
import { tr } from "../i18n";
import { Invitation } from "../components/invitation";
import { Notice, api } from "../components/ui";
type Answer = {
  guest_id: string;
  event_id: string;
  attending: number;
  meal: string;
  dietary: string;
  accessibility: string;
  transport: string;
};
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { env } = context.get(platformContext),
    config = await getConfig(env.DB),
    locale = params.locale || config.defaultLocale,
    page = params.page || "home";
  if (!params.locale) throw redirect(`/${config.defaultLocale}`);
  if (
    !config.locales.includes(locale as "en" | "zh-Hans") ||
    !enabledModules(config).some((m) => m.id === page)
  )
    throw new Response("Not found", { status: 404 });
  const household = await guestSession(request, env),
    invited = await invitedEvents(env.DB, household?.id);
  const guests = household
    ? (
        await env.DB.prepare(
          "SELECT id,name,category FROM guests WHERE household_id=?",
        )
          .bind(household.id)
          .all<{ id: string; name: string; category: string }>()
      ).results
    : [];
  const answers = household
    ? (
        await env.DB.prepare(
          "SELECT r.* FROM rsvps r JOIN guests g ON g.id=r.guest_id WHERE g.household_id=?",
        )
          .bind(household.id)
          .all<Answer>()
      ).results
    : [];
  const seats =
    household &&
    config.features.seating &&
    Date.now() >= Date.parse(config.seatingReleaseAt)
      ? (
          await env.DB.prepare(
            "SELECT g.name,t.name AS table_name,s.event_id FROM seats s JOIN guests g ON g.id=s.guest_id JOIN seating_tables t ON t.id=s.table_id JOIN rsvps r ON r.guest_id=s.guest_id AND r.event_id=s.event_id WHERE g.household_id=? AND r.attending=1",
          )
            .bind(household.id)
            .all<{ name: string; table_name: string; event_id: string }>()
        ).results
      : [];
  const counts = config.features.registry
    ? (
        await env.DB.prepare(
          "SELECT item_id,COUNT(*) AS total FROM reservations WHERE status='purchased' OR (status='reserved' AND expires_at>?) GROUP BY item_id",
        )
          .bind(Date.now())
          .all<{ item_id: string; total: number }>()
      ).results
    : [];
  const reservations =
    household && config.features.registry
      ? (
          await env.DB.prepare(
            "SELECT id,item_id,status FROM reservations WHERE household_id=? AND (status='purchased' OR (status='reserved' AND expires_at>?))",
          )
            .bind(household.id, Date.now())
            .all<{ id: string; item_id: string; status: string }>()
        ).results
      : [];
  const media =
    household &&
    config.features.memories &&
    Date.now() >= Date.parse(config.media.releaseAt)
      ? (
          await env.DB.prepare(
            "SELECT id,name,content_type,caption FROM media WHERE status='approved' ORDER BY created_at DESC LIMIT 200",
          ).all<{
            id: string;
            name: string;
            content_type: string;
            caption: string;
          }>()
        ).results
      : [];
  return {
    config: visibleConfig(config, invited),
    locale,
    page,
    household,
    guests,
    answers,
    invited,
    seats,
    counts,
    reservations,
    media,
  };
}
export default function Site() {
  const data = useLoaderData<typeof loader>(),
    { config, locale, page, household } = data,
    revalidator = useRevalidator(),
    routeLocation = useLocation();
  const [menu, setMenu] = useState(false),
    [error, setError] = useState("");
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  async function action(path: string, input: unknown) {
    setError("");
    try {
      await api(path, input);
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "serverError");
    }
  }
  useEffect(() => {
    const code = new URLSearchParams(routeLocation.hash.slice(1)).get("invite");
    if (!code) return;
    history.replaceState(
      history.state,
      "",
      routeLocation.pathname + routeLocation.search,
    );
    void api("/invitation", { code })
      .then(() => revalidator.revalidate())
      .catch((error) =>
        setError(error instanceof Error ? error.message : "serverError"),
      );
  }, [routeLocation.key]);
  const privatePage = ["rsvp", "seating", "memories"].includes(page);
  return (
    <div
      data-theme={config.theme.preset}
      style={
        config.theme.accent
          ? ({ "--accent": config.theme.accent } as React.CSSProperties)
          : undefined
      }
    >
      <a className="skip-link" href="#main">
        {tr(locale, "viewDay")}
      </a>
      <header className="site-header">
        <Link className="wordmark" to={`/${locale}`}>
          <Flower2 size={22} />
          {config.partners.map((p) => l(p.name)).join(" & ")}
        </Link>
        <button
          className="menu-toggle"
          aria-expanded={menu}
          aria-label={tr(locale, "menu")}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav className={menu ? "open" : ""} aria-label={tr(locale, "home")}>
          {enabledModules(config)
            .filter((m) => m.id !== "home")
            .map((module) => (
              <Link
                key={module.id}
                className={page === module.id ? "active" : ""}
                to={`/${locale}/${module.id}`}
                onClick={() => setMenu(false)}
              >
                {tr(locale, module.id)}
              </Link>
            ))}
        </nav>
        <div className="languages">
          {config.locales.map((language) => (
            <Link
              key={language}
              aria-current={language === locale ? "true" : undefined}
              to={`/${language}/${page === "home" ? "" : page}`}
            >
              {language === "en" ? "EN" : "中文"}
            </Link>
          ))}
        </div>
      </header>
      <main id="main">
        {page === "home" ? (
          <Home data={data} action={action} />
        ) : (
          <section className="page">
            <div className="page-heading">
              <p className="eyebrow">{l(config.siteName)}</p>
              <h1>{tr(locale, page)}</h1>
            </div>
            {privatePage && !household ? (
              <Invitation locale={locale} />
            ) : (
              <>
                {page === "timeline" && (
                  <Timeline data={data} action={action} />
                )}
                {page === "travel" && <Travel data={data} action={action} />}
                {page === "faq" && <Faq data={data} action={action} />}
                {page === "rsvp" && (
                  <Rsvp key={household?.id} data={data} action={action} />
                )}
                {page === "seating" && <Seating data={data} action={action} />}
                {page === "registry" && (
                  <Registry data={data} action={action} />
                )}
                {page === "memories" && (
                  <Memories key={household?.id} data={data} action={action} />
                )}
              </>
            )}
            {error && <Notice error>{tr(locale, error)}</Notice>}
          </section>
        )}
      </main>
      <section className="contact-section">
        <Flower2 size={28} />
        <h2>{tr(locale, "contact")}</h2>
        <p>{tr(locale, "contactText")}</p>
        <a href={`mailto:${config.contact.email}`}>
          {l(config.contact.name)} · {config.contact.email}
        </a>
        {config.contact.phone && (
          <p>
            <a href={`tel:${config.contact.phone.replace(/[^+0-9]/g, "")}`}>
              {config.contact.phone}
            </a>
          </p>
        )}
      </section>
      <footer>
        <span>{tr(locale, "fictional")}</span>
        <div>
          {household && (
            <button onClick={() => void action("/logout", {})}>
              {tr(locale, "logout")}
            </button>
          )}
          <Link to={`/admin?lang=${locale}`}>{tr(locale, "admin")}</Link>
          <a href="https://github.com/zilun-lin/open-wedding">Open source ↗</a>
        </div>
      </footer>
    </div>
  );
}
