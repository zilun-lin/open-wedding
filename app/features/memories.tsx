import { useRevalidator } from "react-router";
import { formatDate } from "../config/schema";
import { tr } from "../i18n";
import { Notice } from "../components/ui";
import { Uploader } from "../components/uploader";
import type { FeatureViewProps } from "./types";
export default function Memories({ data }: FeatureViewProps) {
  const { config, locale } = data;
  const date = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatDate(value, locale, config.timeZone, options);
  const revalidator = useRevalidator();
  return (
    <>
      <p className="intro">{tr(locale, "memoriesHelp")}</p>
      {Date.now() < Date.parse(config.media.releaseAt) ? (
        <Notice>
          {tr(locale, "released")}: {date(config.media.releaseAt)}
        </Notice>
      ) : (
        <>
          <Uploader
            locale={locale}
            config={config}
            onComplete={() => revalidator.revalidate()}
          />
          <div className="gallery">
            {data.media.map((item) => (
              <figure key={item.id}>
                {item.content_type.startsWith("video/") ? (
                  <video
                    controls
                    preload="metadata"
                    src={`/api/media/${item.id}/file`}
                  />
                ) : (
                  <img
                    loading="lazy"
                    src={`/api/media/${item.id}/file`}
                    alt={item.caption || item.name}
                  />
                )}
                <figcaption>
                  {item.caption || item.name} ·{" "}
                  <a
                    className="text-link"
                    download={item.name}
                    href={`/api/media/${item.id}/file`}
                  >
                    {tr(locale, "download")}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
          {!data.media.length && <p>{tr(locale, "noMemories")}</p>}
        </>
      )}
    </>
  );
}
