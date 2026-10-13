import { localize } from "../config/schema";
import type { FeatureViewProps } from "./types";
export default function Faq({ data, action }: FeatureViewProps) {
  const { config, locale } = data;
  const l = (value: Record<string, string>) =>
    localize(value, locale, config.defaultLocale);
  return (
    <div className="faq-list">
      {config.faqs.map((item) => (
        <details key={item.id}>
          <summary>
            {l(item.question)}
            <span>+</span>
          </summary>
          <p>{l(item.answer)}</p>
        </details>
      ))}
    </div>
  );
}
