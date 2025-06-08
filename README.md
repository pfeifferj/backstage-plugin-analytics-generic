# Analytics Module: Generic

This plugin provides a generic implementation of the Backstage Analytics
API for publishing events to POST endpoints such as knative sinks.

This module is made to work with backstage's built-in analytics plugin. The usage guide to start tracking analytics for your plugins can be found here: https://backstage.io/docs/plugins/analytics/

## Installation

1. Install the plugin package in your Backstage app:

```sh
# From your Backstage root directory
yarn add --cwd packages/app @pfeifferj/backstage-plugin-analytics-generic
```

2. Wire up the API implementation to your App:

```tsx
// packages/app/src/apis.ts
import {
  	AnyApiFactory,
  	createApiFactory,
  	discoveryApiRef,
	analyticsApiRef,
	configApiRef,
	errorApiRef,
	identityApiRef, // optional: if you want to add user-context to events
} from '@backstage/core-plugin-api';

import { GenericAnalyticsAPI } from '@pfeifferj/backstage-plugin-analytics-generic';
import { catalogApiRef } from '@backstage/plugin-catalog-react';

export const apis: AnyApiFactory[] = [
	...
	// Instantiate and register the Generic Analytics API Implementation.

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
        		catalogApi,
			),
  	}),
	...
];
```

3. Configure the plugin in your `app-config.yaml`:

The following is the minimum configuration required to start sending analytics
events to a Knative sink. All that's needed is your Knative sink Host:

```yaml
# app-config.yaml
app:
  analytics:
    generic:
      host: ${ANALYTICS_GENERIC_HOST}
      interval: ${ANALYTICS_GENERIC_INTERVAL} # interval in minutes to ship logs, set to 0 for instant streaming. default: 30 mins
      basicAuthToken: ${ANALYTICS_GENERIC_BASIC_AUTH} # basic auth token (optional)
      bearerAuthToken: ${ANALYTICS_GENERIC_BEARER_TOKEN} # bearer token for JWT/OAuth (optional)
      debug: true # logs events & debugging info in console & frontend. default: false (optional)

...
backend:
  cors:
    ...
	Access-Control-Allow-Origin: '*' # your endpoint
```

## Authentication

The plugin supports two authentication methods for securing your analytics endpoint:

- **Basic Authentication**: Set `basicAuthToken` to a base64-encoded `username:password` string
- **Bearer Token**: Set `bearerAuthToken` to a JWT token or OAuth bearer token

If both are configured, basic authentication takes precedence. Choose the method that matches your endpoint's authentication requirements.
