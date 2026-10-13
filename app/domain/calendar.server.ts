import type { WeddingConfig } from "../config/schema";
import { localize } from "../config/schema";
export function calendarFile(
  event: WeddingConfig["events"][number],
  locale: string,
  host = "open-wedding.local",
) {
  const escape = (text: string) =>
    text
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  const utc = (date: string) =>
    new Date(date)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const fold = (line: string) => {
    let output = "",
      count = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (count + bytes > 73) {
        output += "\r\n ";
        count = 1;
      }
      output += char;
      count += bytes;
    }
    return output;
  };
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Open Wedding//Celebration//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${event.id}-${Date.parse(event.startsAt)}@${host}`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(event.endsAt)}`,
      `SUMMARY:${escape(localize(event.name, locale))}`,
      `DESCRIPTION:${escape(localize(event.description, locale))}`,
      `LOCATION:${escape(`${localize(event.venue.name, locale)}, ${localize(event.venue.address, locale)}`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}
