import { AnalyticsEvent, ConfigApi } from '@backstage/core-plugin-api';

type AnalyticsAPI = {
	captureEvent: (event: AnalyticsEvent) => void;
};

type Options = {
	configApi: ConfigApi;
};

export class GenericAnalyticsAPI implements AnalyticsAPI {
	private readonly configApi: ConfigApi;
	private readonly endpoint: string;
	private eventQueue: { event: AnalyticsEvent; timestamp: Date }[] = [];
	private flushInterval: number = 30 * 60 * 1000; // 30 minutes in milliseconds

	constructor(options: Options) {
		this.configApi = options.configApi;
		this.endpoint = this.configApi.getString('app.analytics.endpoint');
		this.startFlushCycle();
	}

	static fromConfig(config: ConfigApi) {
		return new GenericAnalyticsAPI({ configApi: config });
	}

	captureEvent(event: AnalyticsEvent) {
		this.eventQueue.push({ event, timestamp: new Date() });
	}

	private startFlushCycle() {
		setInterval(() => {
			this.flushEvents();
		}, this.flushInterval);
	}

	private async flushEvents() {
		const eventsToFlush = this.eventQueue;

		if (this.eventQueue.length === 0) {
			return;
		}

		try {
			this.eventQueue = [];

			const response = await fetch(this.endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(eventsToFlush),
			});

			if (!response.ok) {
				console.error(
					'Failed to flush analytics events',
					await response.text()
				);
				this.eventQueue.push(...eventsToFlush);
			}
		} catch (error) {
			console.error('Failed to flush analytics events', error);
			this.eventQueue.push(...eventsToFlush);
		}
	}
}
