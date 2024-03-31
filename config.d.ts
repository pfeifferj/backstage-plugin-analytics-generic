export interface Config {
	app?: {
		analytics: {
			generic: {
				/**
				 * Refresh interval
				 * @visibility backend
				 */
				interval: number;
				/**
				 * Endpoint host URL
				 * @visibility frontend
				 */
				host: string;
				/**
				 * Auth credentials
				 * @deepVisibility secret
				 */
				auth: string;
			};
		};
	};
}
