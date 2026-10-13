import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
export const meta: Route.MetaFunction = () => [
  { title: "Open Wedding · A celebration together" },
  {
    name: "description",
    content: "A thoughtful, bilingual place for your wedding celebration.",
  },
  { name: "robots", content: "noindex, nofollow" },
];
export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const zh =
    location.pathname.startsWith("/zh-Hans") ||
    location.search.includes("lang=zh-Hans");
  return (
    <html lang={zh ? "zh-Hans" : "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function App() {
  return <Outlet />;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main className="auth-page">
      <p className="eyebrow">Open Wedding</p>
      <h1>{status === 404 ? "Page not found" : "Please try again"}</h1>
      <p>
        {status === 404
          ? "This page isn't available."
          : "We couldn't load this page. Please contact the hosts if this continues."}
      </p>
      <a className="button" href="/">
        Return home
      </a>
      {import.meta.env.DEV && error instanceof Error && (
        <pre>{error.message}</pre>
      )}
    </main>
  );
}
