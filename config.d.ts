export interface Config {
	app?: {
		analytics: {
			generic: {
				/**
				 * Endpoint host URL, refresh interval
				 * @visibility frontend
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
