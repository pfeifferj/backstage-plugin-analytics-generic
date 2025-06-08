import {
  configApiRef,
  createApiFactory,
  createPlugin,
  analyticsApiRef,
  errorApiRef,
  identityApiRef,
  createApiRef,
  SessionApi,
} from "@backstage/core-plugin-api";
import { rootRouteRef } from "./routes";
import { catalogApiRef } from "@backstage/plugin-catalog-react";
import { GenericAnalyticsAPI } from "./api";

export const sessionApiRef = createApiRef<SessionApi>({
  id: "core.auth.session",
});

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
        sessionApi: sessionApiRef,
      },
      factory: ({ configApi, errorApi, identityApi, catalogApi, sessionApi }) =>
        GenericAnalyticsAPI.fromConfig(
          configApi,
          errorApi,
          identityApi,
          catalogApi,
          sessionApi
        ),
    }),
  ],
});
