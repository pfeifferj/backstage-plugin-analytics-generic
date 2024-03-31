export interface Config {
	app?: {
		analytics: {
			generic: {
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
				auth: string;
			};
		};
	};
}
