import type { WeddingSiteData } from "../routes/site";
export type FeatureViewProps = {
  data: WeddingSiteData;
  action: (path: string, input: unknown) => Promise<void>;
};
