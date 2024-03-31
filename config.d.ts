export interface Config {
	app?: {
		analytics: {
			generic: {
				/**
				 * Endpoint host URL, refresh interval
				 * @visibility backend
				 */
				host: string;
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
