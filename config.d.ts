export interface Config {
	app?: {
		analytics: {
			generic: {
				/**
				 * Endpoint host URL
				 * @visibility frontend
				 */
				host: string;
			};
		};
	};
}
