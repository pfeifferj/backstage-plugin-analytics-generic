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
	analyticsApiRef,
	configApiRef,
	identityApiRef,
} from '@backstage/core-plugin-api';

import { GenericAnalyticsAPI } from '@pfeifferj/backstage-plugin-analytics-generic';

export const apis: AnyApiFactory[] = [
	...
	// Instantiate and register the Generic Analytics API Implementation.

  	createApiFactory({
    	api: analyticsApiRef,
    	deps: { configApi: configApiRef, errorApi: errorApiRef },
    	factory: ({ configApi, errorApi }) =>
      		GenericAnalyticsAPI.fromConfig(configApi, errorApi),
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
  analyticsGeneric:
	host: ${ANALYTICS_GENERIC_HOST}
	interval: ${ANALYTICS_GENERIC_INTERVAL} # interval in minutes to ship logs, set to 0 for instant streaming, default: 30 mins
	auth: ${ANALYTICS_GENERIC_AUTH} # basic auth token (optional)
```
