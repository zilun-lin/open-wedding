import { type RouteConfig, index, route } from "@react-router/dev/routes";
export default [
  index("routes/site.tsx", { id: "index" }),
  route("admin", "routes/admin.tsx"),
  route(":locale/:page?", "routes/site.tsx", { id: "site" }),
] satisfies RouteConfig;
