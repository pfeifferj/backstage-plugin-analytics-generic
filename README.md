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

import { GenericAnalytics } from '@pfeifferj/backstage-plugin-analytics-generic';

export const apis: AnyApiFactory[] = [
	// Instantiate and register the Generic Analytics API Implementation.
	createApiFactory({
		api: analyticsApiRef,
		deps: { configApi: configApiRef },
		factory: ({ configApi }) => GenericAnalytics.fromConfig(configApi),
	}),
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
```

Note: for prod you want some kind of auth here as well and not just rely on network enforced security.

4. Update CSP in your `app-config.yaml`:(optional)

The following is the minimal content security policy required to load scripts from your Knative sink.

```yaml
backend:
  csp:
    connect-src: ["'self'", 'http:', 'https:']
    # Add these two lines below
    script-src: ["'self'", "'unsafe-eval'", '<generic-endpoint-url>']
```
