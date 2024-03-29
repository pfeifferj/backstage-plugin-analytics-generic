import { AnalyticsEvent, ConfigApi } from '@backstage/core-plugin-api';

type AnalyticsAPI = {
	captureEvent: (event: AnalyticsEvent) => void;
};

type Options = {
	configApi: ConfigApi;
};

export class GenericAnalyticsAPI implements AnalyticsAPI {
	private readonly configApi: ConfigApi;
	private readonly host: string;
	private readonly endpoint: string; // Constructed endpoint based on host
	private eventQueue: { event: AnalyticsEvent; timestamp: Date }[] = [];
	private flushInterval: number;
	private authToken?: string;
	private retryLimit: number = 3;
	private eventRetryCounter: Map<string, number> = new Map();

	constructor(options: Options) {
		this.configApi = options.configApi;
		this.host = this.configApi.getString('app.analytics.generic.host');
		this.endpoint = `${this.host}/path/to/your/analytics/endpoint`; // Adjust the path as needed
		const configFlushIntervalMinutes = this.configApi.getOptionalNumber(
			'app.analytics.generic.interval'
		);
		this.flushInterval =
			configFlushIntervalMinutes !== null &&
			configFlushIntervalMinutes !== undefined
				? configFlushIntervalMinutes * 60 * 1000
				: 30 * 60 * 1000; // Default to 30 minutes if not specified
		this.authToken = this.configApi.getOptionalString(
			'app.analytics.generic.authToken'
		);

		if (this.flushInterval === 0) {
			// Instant streaming
			this.captureEvent = this.instantCaptureEvent;
		} else {
			// Periodic flushing
			this.startFlushCycle();
		}
	}

	static fromConfig(config: ConfigApi) {
		return new GenericAnalyticsAPI({ configApi: config });
	}

	captureEvent(event: AnalyticsEvent) {
		// This method will be overridden if instant streaming is enabled
		this.eventQueue.push({ event, timestamp: new Date() });
	}

	private async instantCaptureEvent(event: AnalyticsEvent) {
		// Immediately try to send the event
		await this.flushEvents([event]);
	}

	private startFlushCycle() {
		setInterval(() => {
			this.flushEvents(this.eventQueue.splice(0, this.eventQueue.length));
		}, this.flushInterval);
	}

	private async flushEvents(
		events: { event: AnalyticsEvent; timestamp: Date }[]
	) {
		if (events.length === 0) {
			return;
		}

		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};

			if (this.authToken) {
				headers['Authorization'] = `Basic ${this.authToken}`;
			}

			const response = await fetch(this.endpoint, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(events),
			});

			if (!response.ok) {
				throw new Error(
					`Server responded with non-OK status: ${response.status}`
				);
			}
		} catch (error) {
			console.error('Failed to flush analytics events', error);
			events.forEach((event) => {
				const eventId = JSON.stringify(event);
				const retries = this.eventRetryCounter.get(eventId) || 0;
				if (retries < this.retryLimit) {
					this.eventQueue.push(event);
					this.eventRetryCounter.set(eventId, retries + 1);
				} else {
					console.error('Max retries reached for event:', event);
				}
			});
		}
	}
}
