import { Button } from "./ui";
import type { WeddingConfig } from "../config/schema";
import { tr } from "../i18n";
const names: Record<string, [string, string]> = {
  siteName: ["Site title", "网站标题"],
  welcome: ["Welcome message", "欢迎词"],
  story: ["Your story", "你们的故事"],
  venue: ["Venue", "场地"],
  name: ["Name", "名称"],
  address: ["Address", "地址"],
  directions: ["Getting there", "交通说明"],
  mapUrl: ["Map link (optional)", "地图链接（可选）"],
  events: ["Events", "活动"],
  travel: ["Travel and accommodation", "交通与住宿"],
  faqs: ["Frequently asked questions", "常见问题"],
  registry: ["Registry links", "礼物链接"],
  seatingReleaseAt: [
    "Seating release (ISO date with time zone)",
    "座位公布时间（含时区的ISO日期）",
  ],
  media: ["Gallery and uploads", "相册及上传"],
  releaseAt: [
    "Gallery opens (ISO date with time zone)",
    "相册开放时间（含时区的ISO日期）",
  ],
  maxFileMb: ["Maximum file size (MB, up to 90)", "单个文件上限（MB，最多90）"],
  maxFilesPerHousehold: ["Files per household", "每个家庭文件数上限"],
  maxTotalMbPerHousehold: [
    "Total MB per household",
    "每个家庭总容量上限（MB）",
  ],
  id: [
    "Stable ID — keep existing IDs when editing",
    "固定编号：编辑现有条目时请勿更改",
  ],
  description: ["Description", "说明"],
  startsAt: ["Starts (ISO date with time zone)", "开始时间（含时区的ISO日期）"],
  endsAt: ["Ends (ISO date with time zone)", "结束时间（含时区的ISO日期）"],
  visibility: ["Who can see this event", "活动可见范围"],
  rsvp: ["Collect replies for this event", "收集此活动的出席回复"],
  title: ["Title", "标题"],
  text: ["Details", "详细信息"],
  url: ["Website link", "网站链接"],
  question: ["Question", "问题"],
  answer: ["Answer", "回答"],
  kind: ["Registry type", "礼物类型"],
  quantity: ["Number available", "可预留数量"],
};
const localized = (en: string, zh: string) => ({ en, "zh-Hans": zh });
const emptyVenue = {
  name: localized("Venue", "场地"),
  address: localized("Address", "地址"),
  directions: localized("Directions", "交通说明"),
};
const templates: Record<string, unknown> = {
  events: {
    id: "event",
    name: localized("New event", "新活动"),
    description: localized("Event details", "活动详情"),
    startsAt: "2027-09-18T15:00:00+01:00",
    endsAt: "2027-09-18T16:00:00+01:00",
    venue: emptyVenue,
    visibility: "public",
    rsvp: true,
  },
  travel: {
    id: "travel",
    title: localized("Travel information", "交通信息"),
    text: localized("Add details here", "请在此填写详情"),
  },
  faqs: {
    id: "question",
    question: localized("Your question", "您的问题"),
    answer: localized("Your answer", "您的回答"),
  },
  registry: {
    id: "gift",
    title: localized("Gift", "礼物"),
    description: localized("Gift details", "礼物详情"),
    kind: "link",
    url: "https://example.com",
    quantity: 1,
  },
};
const options: Record<string, string[]> = {
  visibility: ["public", "invited"],
  kind: ["link", "gift", "fund"],
};
export function ContentEditor({
  value,
  locale,
  onChange,
}: {
  value: WeddingConfig;
  locale: string;
  onChange: (update: (draft: WeddingConfig) => void) => void;
}) {
  const label = (key: string) => names[key]?.[locale === "en" ? 0 : 1] || key;
  const set = (path: (string | number)[], next: unknown) =>
    onChange((draft) => {
      let target = draft as unknown as Record<string | number, unknown>;
      for (const key of path.slice(0, -1))
        target = target[key] as Record<string | number, unknown>;
      if (next === "" && ["mapUrl"].includes(String(path.at(-1))))
        delete target[path.at(-1)!];
      else target[path.at(-1)!] = next;
    });
  function render(
    item: unknown,
    path: (string | number)[],
    key: string,
  ): React.ReactNode {
    if (Array.isArray(item))
      return (
        <div className="content-list">
          {item.map((child, i) => (
            <details className="card" key={i}>
              <summary>
                {label(key)} {i + 1}
              </summary>
              <div className="editor-nested">
                {render(child, [...path, i], key)}
              </div>
              <Button
                className="secondary"
                type="button"
                onClick={() => {
                  if (confirm(tr(locale, "remove") + "?"))
                    set(
                      path,
                      item.filter((_, index) => index !== i),
                    );
                }}
              >
                {tr(locale, "remove")}
              </Button>
            </details>
          ))}
          {!!templates[key] && (
            <Button
              type="button"
              className="secondary"
              onClick={() => {
                const next = structuredClone(templates[key]) as Record<
                  string,
                  unknown
                >;
                next.id = `${key}-${crypto.randomUUID().slice(0, 8)}`;
                if (key === "events") {
                  next.startsAt = value.celebrationAt;
                  next.endsAt = new Date(
                    Date.parse(value.celebrationAt) + 3600000,
                  ).toISOString();
                }
                set(path, [...item, next]);
              }}
            >
              {locale === "en" ? "Add item" : "添加条目"}
            </Button>
          )}
        </div>
      );
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if ("en" in record || "zh-Hans" in record)
        return (
          <div className="form-grid">
            {value.locales.map((lang) => (
              <label className="field" key={lang}>
                <span>
                  {label(key)} · {lang === "en" ? "English" : "简体中文"}
                </span>
                <textarea
                  rows={
                    key === "answer" ||
                    key === "story" ||
                    key === "description" ||
                    key === "text"
                      ? 3
                      : 2
                  }
                  value={String(record[lang] || "")}
                  onChange={(e) => set([...path, lang], e.target.value)}
                />
              </label>
            ))}
          </div>
        );
      const fields =
        key === "venue" && !record.mapUrl ? { ...record, mapUrl: "" } : record;
      return Object.entries(fields).map(([name, child]) => (
        <div key={name}>{render(child, [...path, name], name)}</div>
      ));
    }
    if (typeof item === "boolean")
      return (
        <label className="checkbox-group">
          <input
            type="checkbox"
            checked={item}
            onChange={(e) => set(path, e.target.checked)}
          />
          {label(key)}
        </label>
      );
    return (
      <label className="field">
        <span>{label(key)}</span>
        {options[key] ? (
          <select
            value={String(item)}
            onChange={(e) => set(path, e.target.value)}
          >
            {options[key].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        ) : (
          <input
            type={typeof item === "number" ? "number" : "text"}
            value={String(item ?? "")}
            onChange={(e) =>
              set(
                path,
                typeof item === "number"
                  ? Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        )}
      </label>
    );
  }
  return (
    <div className="content-editor">
      {(
        [
          "siteName",
          "welcome",
          "story",
          "venue",
          "events",
          "travel",
          "faqs",
          "registry",
          "seatingReleaseAt",
          "media",
        ] as const
      ).map((section) => (
        <details className="card" key={section}>
          <summary>{label(section)}</summary>
          <div className="editor-nested">
            {render(value[section], [section], section)}
          </div>
        </details>
      ))}
    </div>
  );
}
