export interface Config {
	app?: {
		analytics: {
			generic: {
				/**
				 * Toggle debugging
				 * @visibility frontend
				 */
				debug: boolean;
				/**
				 * Endpoint host URL
				 * @visibility frontend
				 */
				host: string;
				/**
				 * Refresh interval
				 * @visibility frontend
				 */
				interval: number;
				/**
				 * Basic auth credentials
				 * @deepVisibility secret
				 */
				basicAuthToken?: string;
				/**
				 * Bearer auth token
				 * @deepVisibility secret
				 */
				bearerAuthToken?: string;
				/**
				 * Enable team metadata capture from catalog API
				 * @visibility frontend
				 */
				includeTeamMetadata?: boolean;
			};
		};
	};
}
