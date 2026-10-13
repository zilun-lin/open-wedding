import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values: Parameters<typeof clsx>) =>
  twMerge(clsx(...values));
export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("button", className)} {...props} />;
}
export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={cn("notice", error && "notice-error")}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export async function api(path: string, data?: unknown) {
  const response = await fetch(`/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = (await response.json()) as {
    error?: string;
    issues?: { path: string; message: string }[];
    [key: string]: unknown;
  };
  if (!response.ok)
    throw new Error(
      result.issues?.map((i) => `${i.path}: ${i.message}`).join("\n") ||
        result.error ||
        "serverError",
    );
  return result;
}
