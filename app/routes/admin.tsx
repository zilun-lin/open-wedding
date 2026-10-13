import { useState } from "react";
import {
  Link,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { Flower2, ArrowUpRight, Check, Users, Mail } from "lucide-react";
import { platformContext } from "../platform/context";
import { getConfig } from "../platform/config.server";
import { auth } from "../platform/auth.server";
import { localize } from "../config/schema";
import { tr } from "../i18n";
import { api, Button, Field, Notice } from "../components/ui";
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.get(platformContext),
    config = getConfig(),
    locale =
      new URL(request.url).searchParams.get("lang") === "zh-Hans"
        ? "zh-Hans"
        : "en";
  const configured = !!(await env.DB.prepare(
    "SELECT id FROM user WHERE role='admin' LIMIT 1",
  ).first());
  const session = env.AUTH_SECRET
    ? await auth(env, new URL(request.url).origin).api.getSession({
        headers: request.headers,
      })
    : null;
  if (!session || session.user.role !== "admin")
    return {
      locale,
      configured,
      admin: null,
      config: null,
      households: [],
      guests: [],
      tables: [],
      rsvps: [],
      seats: [],
      media: [],
      outbox: [],
      emailReady: false,
    };
  const query = async <T,>(sql: string) =>
    (await env.DB.prepare(sql).all<T>()).results;
  const [households, guests, tables, rsvps, seats, media, outbox] =
    await Promise.all([
      query<{ id: string; name: string; email: string; locale: string }>(
        "SELECT id,name,email,locale FROM households ORDER BY name",
      ),
      query<{ id: string; household_id: string; name: string }>(
        "SELECT id,household_id,name FROM guests ORDER BY name",
      ),
      query<{ id: string; event_id: string; name: string; capacity: number }>(
        "SELECT * FROM seating_tables ORDER BY name",
      ),
      query<{ guest_id: string; event_id: string; attending: number }>(
        "SELECT guest_id,event_id,attending FROM rsvps",
      ),
      query<{ guest_id: string; event_id: string; table_id: string }>(
        "SELECT * FROM seats",
      ),
      query<{ id: string; name: string; content_type: string; status: string }>(
        "SELECT id,name,content_type,status FROM media WHERE status IN ('pending','approved') ORDER BY created_at DESC LIMIT 200",
      ),
      query<{ status: string; total: number }>(
        "SELECT status,COUNT(*) AS total FROM outbox GROUP BY status",
      ),
    ]);
  return {
    locale,
    configured,
    admin: { name: session.user.name },
    config,
    households,
    guests,
    tables,
    rsvps,
    seats,
    media,
    outbox,
    emailReady: !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
  };
}
export default function Admin() {
  const data = useLoaderData<typeof loader>(),
    { locale, admin, config } = data,
    revalidator = useRevalidator(),
    [tab, setTab] = useState("overview"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(path: string, value: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api(path, value);
      setNotice("saved");
      revalidator.revalidate();
      return result;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "serverError");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <Link className="wordmark" to={`/${locale}`}>
          <Flower2 size={22} />
          Open Wedding
        </Link>
        <span>{tr(locale, "admin")}</span>
        <div className="languages">
          <Link to="/admin?lang=en">EN</Link>
          <Link to="/admin?lang=zh-Hans">中文</Link>
        </div>
        {admin && (
          <Button
            className="secondary"
            onClick={() => void action("/auth/sign-out", {})}
          >
            {tr(locale, "signOut")}
          </Button>
        )}
      </header>
      {!admin ? (
        <AuthForm
          locale={locale}
          configured={data.configured}
          onSubmit={action}
          notice={notice}
          busy={busy}
        />
      ) : (
        <div className="admin-layout">
          <aside>
            <p className="eyebrow">{admin.name}</p>
            {[
              "overview",
              "invitations",
              ...(config!.features.seating ? ["seatingPlan"] : []),
              ...(config!.features.memories ? ["moderation"] : []),
              "messages",
            ].map((item) => (
              <button
                className={tab === item ? "active" : ""}
                key={item}
                onClick={() => {
                  setTab(item);
                  setNotice("");
                }}
              >
                {tr(locale, item)}
              </button>
            ))}
            <Link className="text-link" to={`/${locale}`}>
              {tr(locale, "back")}
              <ArrowUpRight size={16} />
            </Link>
          </aside>
          <main>
            <div className="page-heading">
              <p className="eyebrow">Open Wedding</p>
              <h1>{tr(locale, tab)}</h1>
            </div>
            {notice && (
              <Notice error={notice !== "saved"}>{tr(locale, notice)}</Notice>
            )}
            {tab === "overview" && (
              <>
                <div className="stat-grid">
                  {[
                    ["totalHouseholds", data.households.length, Users],
                    ["totalGuests", data.guests.length, Users],
                    ["responses", data.rsvps.length, Check],
                  ].map(([key, total, Icon]) => {
                    const I = Icon as typeof Users;
                    return (
                      <div className="card" key={String(key)}>
                        <I size={20} />
                        <strong className="stat-value">{Number(total)}</strong>
                        <span>{tr(locale, String(key))}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="card">
                  <Mail />
                  <h2>{tr(locale, "emails")}</h2>
                  {!data.emailReady && (
                    <Notice error>{tr(locale, "emailNotConfigured")}</Notice>
                  )}
                  <div className="pills">
                    {data.outbox.map((row) => (
                      <span key={row.status}>
                        {row.status}: {row.total}
                      </span>
                    ))}
                  </div>
                  <p className="muted">{tr(locale, "messageHelp")}</p>
                </div>
                <div className="card">
                  <Users />
                  <h2>{tr(locale, "export")}</h2>
                  <a className="button secondary" href="/api/admin/export">
                    {tr(locale, "export")}
                  </a>
                </div>
              </>
            )}
            {tab === "invitations" && (
              <Invitations data={data} busy={busy} action={action} />
            )}
            {tab === "seatingPlan" && (
              <>
                <form
                  className="card form-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action("/admin/table", {
                      name: f.get("name"),
                      eventId: f.get("event"),
                      capacity: Number(f.get("capacity")),
                    });
                    e.currentTarget.reset();
                  }}
                >
                  <Field name="name" label={tr(locale, "table")} required />
                  <label className="field">
                    <span>{tr(locale, "event")}</span>
                    <select name="event">
                      {config!.events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {localize(event.name, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    name="capacity"
                    label={tr(locale, "capacity")}
                    type="number"
                    defaultValue={8}
                    min={1}
                    max={100}
                    required
                  />
                  <Button disabled={busy}>{tr(locale, "addTable")}</Button>
                </form>
                <div className="pills">
                  {data.tables.map((table) => (
                    <span key={table.id}>
                      {table.name}:{" "}
                      {data.seats.filter((s) => s.table_id === table.id).length}
                      /{table.capacity}
                    </span>
                  ))}
                </div>
                {config!.events.map((event) => (
                  <section className="card" key={event.id}>
                    <h2>{localize(event.name, locale)}</h2>
                    {data.rsvps
                      .filter((r) => r.event_id === event.id && r.attending)
                      .map((r) => {
                        const guest = data.guests.find(
                          (g) => g.id === r.guest_id,
                        );
                        return (
                          <label className="seat-row" key={r.guest_id}>
                            <span>{guest?.name}</span>
                            <select
                              aria-label={`${tr(locale, "assign")}: ${guest?.name}`}
                              value={
                                data.seats.find(
                                  (s) =>
                                    s.event_id === event.id &&
                                    s.guest_id === r.guest_id,
                                )?.table_id || ""
                              }
                              onChange={(e) =>
                                void action("/admin/seat", {
                                  guestId: r.guest_id,
                                  eventId: event.id,
                                  tableId: e.target.value,
                                })
                              }
                            >
                              <option value="">
                                {tr(locale, "unassigned")}
                              </option>
                              {data.tables
                                .filter((t) => t.event_id === event.id)
                                .map((table) => (
                                  <option key={table.id} value={table.id}>
                                    {table.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        );
                      })}
                  </section>
                ))}
              </>
            )}
            {tab === "moderation" && (
              <div className="gallery">
                {data.media.map((item) => (
                  <article className="card" key={item.id}>
                    {item.content_type.startsWith("video/") ? (
                      <video
                        controls
                        preload="metadata"
                        src={`/api/media/${item.id}/file`}
                      />
                    ) : (
                      <img src={`/api/media/${item.id}/file`} alt={item.name} />
                    )}
                    <h3>{item.name}</h3>
                    <p>
                      {tr(
                        locale,
                        item.status === "approved" ? "approved" : "pending",
                      )}
                    </p>
                    <div className="button-row">
                      {item.status === "pending" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void action("/admin/media", {
                              id: item.id,
                              action: "approve",
                            })
                          }
                        >
                          {tr(locale, "approve")}
                        </Button>
                      )}
                      <Button
                        disabled={busy}
                        className="secondary"
                        onClick={() => {
                          if (
                            window.confirm(
                              `${tr(locale, "remove")}: ${item.name}?`,
                            )
                          )
                            void action("/admin/media", {
                              id: item.id,
                              action: "delete",
                            });
                        }}
                      >
                        {tr(locale, "remove")}
                      </Button>
                    </div>
                  </article>
                ))}
                {!data.media.length && <p>{tr(locale, "empty")}</p>}
              </div>
            )}
            {tab === "messages" && (
              <Messages data={data} busy={busy} action={action} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
type AdminData = Awaited<ReturnType<typeof loader>>;
type Action = (
  path: string,
  value: unknown,
) => Promise<Record<string, unknown> | null>;
function AuthForm({
  locale,
  configured,
  onSubmit,
  notice,
  busy,
}: {
  locale: string;
  configured: boolean;
  onSubmit: Action;
  notice: string;
  busy: boolean;
}) {
  const [forgot, setForgot] = useState(false),
    [search] = useSearchParams(),
    token = search.get("token");
  if (token)
    return (
      <main className="auth-page">
        <h1>{tr(locale, "resetPassword")}</h1>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSubmit("/auth/reset-password", {
              token,
              newPassword: f.get("password"),
            });
          }}
        >
          <Field
            name="password"
            label={tr(locale, "password")}
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
          />
          <Button disabled={busy}>{tr(locale, "resetPassword")}</Button>
        </form>
        {notice && (
          <Notice error={notice !== "saved"}>{tr(locale, notice)}</Notice>
        )}
        <Link to="/admin">{tr(locale, "signIn")}</Link>
      </main>
    );
  if (forgot)
    return (
      <main className="auth-page">
        <h1>{tr(locale, "resetPassword")}</h1>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSubmit("/auth/request-password-reset", {
              email: f.get("email"),
              redirectTo: location.origin + "/admin?reset=true",
            });
          }}
        >
          <Field
            name="email"
            label={tr(locale, "email")}
            type="email"
            required
          />
          <Button disabled={busy}>{tr(locale, "requestReset")}</Button>
        </form>
        {notice && (
          <Notice error={notice !== "saved"}>
            {tr(locale, notice === "saved" ? "resetRequested" : notice)}
          </Notice>
        )}
        <Button className="secondary" onClick={() => setForgot(false)}>
          {tr(locale, "signIn")}
        </Button>
      </main>
    );
  return (
    <main className="auth-page">
      <p className="eyebrow">Open Wedding</p>
      <h1>{tr(locale, configured ? "login" : "setup")}</h1>
      {!configured && <p>{tr(locale, "setupHelp")}</p>}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSubmit(
            configured ? "/auth/sign-in/email" : "/setup",
            configured
              ? { email: f.get("email"), password: f.get("password") }
              : {
                  token: f.get("token"),
                  name: f.get("name"),
                  email: f.get("email"),
                  password: f.get("password"),
                },
          );
        }}
      >
        {!configured && (
          <>
            <Field
              name="token"
              label={tr(locale, "setupToken")}
              type="password"
              required
              autoComplete="off"
            />
            <Field name="name" label={tr(locale, "hostName")} required />
          </>
        )}
        <Field
          name="email"
          label={tr(locale, "email")}
          type="email"
          required
          autoComplete="username"
        />
        <Field
          name="password"
          label={tr(locale, "password")}
          type="password"
          required
          minLength={12}
          autoComplete={configured ? "current-password" : "new-password"}
        />
        <Button disabled={busy}>
          {tr(
            locale,
            busy ? "loading" : configured ? "signIn" : "createAccount",
          )}
        </Button>
      </form>
      {configured && (
        <Button className="secondary" onClick={() => setForgot(true)}>
          {tr(locale, "forgotPassword")}
        </Button>
      )}
      {notice && (
        <Notice error={notice !== "saved"}>
          {tr(
            locale,
            notice === "saved" && !configured ? "accountCreated" : notice,
          )}
        </Notice>
      )}
      <Link className="text-link" to={`/${locale}`}>
        {tr(locale, "back")}
      </Link>
    </main>
  );
}
function Invitations({
  data,
  busy,
  action,
}: {
  data: AdminData;
  busy: boolean;
  action: Action;
}) {
  const { config, locale } = data,
    [invite, setInvite] = useState<Record<string, unknown> | null>(null);
  return (
    <>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            result = await action("/admin/households", {
              name: f.get("name"),
              email: f.get("email"),
              locale: f.get("locale"),
              eventIds: f.getAll("events"),
              guests: String(f.get("guests"))
                .split("\n")
                .map((n) => n.trim())
                .filter(Boolean)
                .map((name) => ({ name, category: f.get("category") })),
            });
          if (result) setInvite(result);
        }}
      >
        <h2>{tr(locale, "addHousehold")}</h2>
        <div className="form-grid">
          <Field
            name="name"
            label={tr(locale, "household")}
            required
            maxLength={100}
          />
          <Field name="email" label={tr(locale, "email")} type="email" />
          <label className="field">
            <span>{tr(locale, "language")}</span>
            <select name="locale">
              {config!.locales.map((lang) => (
                <option value={lang} key={lang}>
                  {lang === "en" ? "English" : "简体中文"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              {tr(locale, "guestName")} · {tr(locale, "adult")}/
              {tr(locale, "child")}
            </span>
            <select name="category">
              {["adult", "child", "infant"].map((category) => (
                <option value={category} key={category}>
                  {tr(locale, category)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{tr(locale, "householdNames")}</span>
          <textarea name="guests" required rows={4} />
        </label>
        <fieldset className="checkbox-group">
          <legend>{tr(locale, "invitedEvents")}</legend>
          {config!.events.map((event) => (
            <label key={event.id}>
              <input
                name="events"
                type="checkbox"
                value={event.id}
                defaultChecked
              />
              {localize(event.name, locale)}
            </label>
          ))}
        </fieldset>
        <Button disabled={busy}>{tr(locale, "addHousehold")}</Button>
      </form>
      {invite && (
        <Notice>
          <p>{tr(locale, "copyCode")}</p>
          <code className="invite-code">{String(invite.code)}</code>
          {!!invite.url && (
            <p>
              <a href={String(invite.url)}>{tr(locale, "privateLink")}</a>
              <input
                aria-label={tr(locale, "privateLink")}
                readOnly
                value={String(invite.url)}
                onFocus={(e) => e.target.select()}
              />
            </p>
          )}
        </Notice>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr(locale, "household")}</th>
              <th>{tr(locale, "totalGuests")}</th>
              <th>{tr(locale, "language")}</th>
              <th>{tr(locale, "invitations")}</th>
            </tr>
          </thead>
          <tbody>
            {data.households.map((h) => (
              <tr key={h.id}>
                <td>
                  {h.name}
                  <small>{h.email}</small>
                </td>
                <td>
                  {data.guests.filter((g) => g.household_id === h.id).length}
                </td>
                <td>{h.locale}</td>
                <td>
                  <Button
                    className="secondary"
                    onClick={async () => {
                      if (confirm(tr(locale, "rotate") + "?")) {
                        const next = await action("/admin/revoke", {
                          id: h.id,
                        });
                        if (next) setInvite(next);
                      }
                    }}
                  >
                    {tr(locale, "rotate")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Messages({
  data,
  busy,
  action,
}: {
  data: AdminData;
  busy: boolean;
  action: Action;
}) {
  const { locale, config } = data,
    [preview, setPreview] = useState<{
      subject: string;
      message: string;
      locale: string;
      eventId: string;
    } | null>(null),
    [queued, setQueued] = useState<number | null>(null);
  return (
    <>
      <p>{tr(locale, "messageHelp")}</p>
      {!data.emailReady && (
        <Notice error>{tr(locale, "emailNotConfigured")}</Notice>
      )}
      <form
        className="card"
        onChange={() => setPreview(null)}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPreview({
            subject: String(f.get("subject")),
            message: String(f.get("message")),
            locale: String(f.get("locale")),
            eventId: String(f.get("eventId")),
          });
          setQueued(null);
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>{tr(locale, "language")}</span>
            <select name="locale">
              {config!.locales.map((lang) => (
                <option key={lang}>{lang}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr(locale, "event")}</span>
            <select name="eventId">
              <option value="">{tr(locale, "allEvents")}</option>
              {config!.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {localize(event.name, locale)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Field
          name="subject"
          label={tr(locale, "subject")}
          required
          maxLength={150}
        />
        <label className="field">
          <span>{tr(locale, "message")}</span>
          <textarea name="message" required maxLength={5000} rows={8} />
        </label>
        <Button className="secondary">{tr(locale, "preview")}</Button>
      </form>
      {preview && (
        <section className="card">
          <p className="eyebrow">
            {tr(locale, "preview")} · {preview.locale}
          </p>
          <h2>{preview.subject}</h2>
          <p className="preserve-lines">{preview.message}</p>
          <Button
            disabled={busy || queued !== null}
            onClick={async () => {
              const result = await action("/admin/announce", {
                ...preview,
                confirm: true,
              });
              if (result) setQueued(Number(result.queued));
            }}
          >
            {tr(locale, "queueEmails")}
          </Button>
        </section>
      )}
      {queued !== null && (
        <Notice>
          {queued} {tr(locale, "queued")}
        </Notice>
      )}
    </>
  );
}
