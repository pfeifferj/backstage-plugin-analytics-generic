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
				 * Auth credentials
				 * @deepVisibility secret
				 */
				basicAuthToken: string;
			};
		};
	};
}
