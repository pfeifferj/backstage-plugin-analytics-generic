import {
  configApiRef,
  createApiFactory,
  createPlugin,
  analyticsApiRef,
  errorApiRef,
  identityApiRef,
} from "@backstage/core-plugin-api";
import { rootRouteRef } from "./routes";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import { GenericAnalyticsAPI } from "./api";

export const analyticsModuleGenericPlugin = createPlugin({
  id: "analytics-module-generic",
  routes: {
    root: rootRouteRef,
  },

  apis: [
    createApiFactory({
      api: analyticsApiRef,
      deps: {
        configApi: configApiRef,
        errorApi: errorApiRef,
        identityApi: identityApiRef,
        catalogApi: catalogApiRef,
      },
      factory: ({ configApi, errorApi, identityApi, catalogApi }) =>
        GenericAnalyticsAPI.fromConfig(
          configApi,
          errorApi,
          identityApi,
          catalogApi
        ),
    }),
  ],
});
