import { useEffect, useRef } from "react";
import type { WeddingConfig } from "../config/schema";
import { tr } from "../i18n";
import { api } from "./ui";
export function Uploader({
  config,
  locale,
  onComplete,
}: {
  config: WeddingConfig;
  locale: string;
  onComplete: () => void;
}) {
  const target = useRef<HTMLDivElement>(null),
    callback = useRef(onComplete);
  callback.current = onComplete;
  useEffect(() => {
    let cleanup: () => void = () => {};
    let disposed = false;
    void Promise.all([
      import("@uppy/core"),
      import("@uppy/dashboard"),
      import("@uppy/xhr-upload"),
      import("@uppy/locales/lib/zh_CN"),
    ])
      .then(
        ([
          { default: Uppy },
          { default: Dashboard },
          { default: XHRUpload },
          { default: zh },
        ]) => {
          if (disposed || !target.current) return;
          const uppy = new Uppy({
            locale: locale === "zh-Hans" ? zh : undefined,
            restrictions: {
              maxFileSize: config.media.maxFileMb * 1024 * 1024,
              maxNumberOfFiles: config.media.maxFilesPerHousehold,
              allowedFileTypes: [
                "image/jpeg",
                "image/png",
                "image/webp",
                "video/mp4",
                "video/webm",
              ],
            },
            onBeforeUpload: () => true,
          });
          uppy.use(Dashboard, {
            target: target.current,
            inline: true,
            height: 300,
            proudlyDisplayPoweredByUppy: false,
            note: `${tr(locale, "mediaLimit")} ${config.media.maxFileMb} MB`,
          });
          uppy.use(XHRUpload, {
            endpoint: async (fileOrBundle) => {
              if (Array.isArray(fileOrBundle))
                throw new Error("Bundles are disabled");
              const file = fileOrBundle;
              if (file.meta.uploadId)
                return `/api/media/${file.meta.uploadId}/file`;
              const result = await api("/media/start", {
                name: file.name,
                type: file.type,
                size: file.size,
              });
              uppy.setFileMeta(file.id, { uploadId: result.id });
              return `/api/media/${result.id}/file`;
            },
            formData: false,
            method: "POST",
            headers: (file) => ({ "Content-Type": file.type }),
            limit: 2,
          });
          uppy.on("complete", () => callback.current());
          cleanup = () => uppy.destroy();
        },
      )
      .catch(() => {
        if (target.current)
          target.current.textContent = tr(locale, "serverError");
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [config.media.maxFileMb, config.media.maxFilesPerHousehold, locale]);
  return (
    <div ref={target} className="uploader" aria-label={tr(locale, "upload")} />
  );
}
