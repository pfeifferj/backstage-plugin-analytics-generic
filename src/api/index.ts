import { AnalyticsEvent, ConfigApi } from '@backstage/core-plugin-api';
import { ErrorApi } from '@backstage/core-plugin-api';

type AnalyticsAPI = {
	captureEvent: (event: AnalyticsEvent) => void;
};

type Options = {
	configApi: ConfigApi;
	errorApi: ErrorApi;
};

export class GenericAnalyticsAPI implements AnalyticsAPI {
	private readonly configApi: ConfigApi;
	private readonly errorApi: ErrorApi;
	private readonly host: string;
	private readonly endpoint: string;
	private eventQueue: { event: AnalyticsEvent; timestamp: Date }[] = [];
	private flushInterval: number;
	private authToken?: string;
	private retryLimit: number = 3;
	private eventRetryCounter: Map<string, number> = new Map();

	constructor(options: Options) {
		this.configApi = options.configApi;
		this.errorApi = options.errorApi;
		this.host = this.configApi.getString('app.analytics.generic.host');
		this.endpoint = this.host;
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
			this.captureEvent = this.instantCaptureEvent;
		} else {
			this.startFlushCycle();
		}
	}

	static fromConfig(config: ConfigApi, errorApi: ErrorApi) {
		return new GenericAnalyticsAPI({ configApi: config, errorApi: errorApi });
	}

	captureEvent(event: AnalyticsEvent) {
		console.log('Capturing event:', event);
		this.eventQueue.push({ event, timestamp: new Date() });
		if (this.flushInterval === 0) {
			const eventToFlush = this.eventQueue.pop();
			if (eventToFlush) {
				this.flushEvents([eventToFlush]);
			}
		}
	}

	private async instantCaptureEvent(event: AnalyticsEvent) {
		const eventWithTimestamp = { event, timestamp: new Date() };
		await this.flushEvents([eventWithTimestamp]);
	}

	private startFlushCycle() {
		setInterval(() => {
			if (this.eventQueue.length > 0) {
				this.flushEvents(this.eventQueue.splice(0));
			}
		}, this.flushInterval);
	}

	private async flushEvents(
		events: { event: AnalyticsEvent; timestamp: Date }[]
	) {
		if (events.length === 0) {
			console.log('No events to flush.');
			return;
		}

		console.log(
			`Flushing ${events.length} events to endpoint: ${this.endpoint}`
		);

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

			console.log('Successfully flushed events.');
		} catch (error) {
			console.error('Failed to flush analytics events', error);
			this.errorApi.post(
				new Error(`Failed to flush analytics events: ${error}`)
			);

			events.forEach((event) => {
				const eventId = JSON.stringify(event);
				const retries = this.eventRetryCounter.get(eventId) || 0;
				if (retries < this.retryLimit) {
					this.eventQueue.push(event);
					this.eventRetryCounter.set(eventId, retries + 1);
				} else {
					console.error(`Max retries reached for event: ${eventId}`);
					this.errorApi.post(
						new Error(`Max retries reached for event: ${eventId}`)
					);
				}
			});
		}
	}
}
