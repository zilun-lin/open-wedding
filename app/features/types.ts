import type { loader } from "../routes/site";
export type FeatureViewProps = {
  data: Awaited<ReturnType<typeof loader>>;
  action: (path: string, input: unknown) => Promise<void>;
};
