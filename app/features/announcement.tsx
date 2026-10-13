import { Link } from "react-router";
import { localize } from "../config/schema";
import type { announcementConfig } from "../platform/config.server";

export default function Announcement({
  config,
  locale,
}: {
  config: ReturnType<typeof announcementConfig>;
  locale: string;
}) {
  const l = (text: Record<string, string>) =>
    localize(text, locale, config.defaultLocale);
  return (
    <div
      className="announcement"
      data-theme={config.theme.preset}
      style={
        config.theme.accent
          ? ({ "--accent": config.theme.accent } as React.CSSProperties)
          : undefined
      }
    >
      <nav
        className="announcement-languages"
        aria-label={locale === "zh-Hans" ? "语言" : "Language"}
      >
        {config.locales.map((language) => (
          <Link
            key={language}
            to={`/${language}`}
            lang={language}
            aria-current={locale === language ? "page" : undefined}
          >
            {language === "en" ? "English" : "中文"}
          </Link>
        ))}
      </nav>
      <main className="announcement-card">
        <svg
          className="announcement-flower"
          viewBox="0 0 160 180"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M80 156V77M80 136C59 133 44 119 42 106C61 105 76 116 80 136ZM80 116C104 111 116 94 115 82C94 85 82 98 80 116Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M80 77C55 80 45 64 51 53C34 40 48 23 62 30C68 8 91 8 97 30C114 24 126 42 109 54C115 69 101 82 80 77Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle
            cx="80"
            cy="49"
            r="10"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <p className="eyebrow">{l(config.siteName)}</p>
        <h1>
          {l(config.partners[0].name)}
          <span className="announcement-ampersand">&amp;</span>
          {l(config.partners[1].name)}
        </h1>
        <div className="announcement-divider" aria-hidden="true" />
        <p className="announcement-message">{l(config.welcome)}</p>
      </main>
    </div>
  );
}
