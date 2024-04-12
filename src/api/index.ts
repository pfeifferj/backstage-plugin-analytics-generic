import {
	AnalyticsEvent,
	ConfigApi,
	ErrorApi,
	IdentityApi,
} from '@backstage/core-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';

type AnalyticsAPI = {
	captureEvent: (event: AnalyticsEvent) => void;
};

type Options = {
	configApi: ConfigApi;
	errorApi: ErrorApi;
	identityApi: IdentityApi;
	catalogApi: CatalogApi;
};

export class GenericAnalyticsAPI implements AnalyticsAPI {
	private readonly configApi: ConfigApi;
	private readonly catalogApi: CatalogApi;
	private readonly errorApi: ErrorApi;
	private readonly host: string;
	private readonly endpoint: string;
	private readonly identityApi: IdentityApi;
	private eventQueue: {
		event: AnalyticsEvent;
		timestamp: Date;
		user?: string;
		teamMetadata?: Entity;
	}[] = [];
	private flushInterval: number;
	private basicAuthToken?: string;
	private retryLimit: number = 3;
	private eventRetryCounter: Map<string, number> = new Map();
	private debug: boolean;

	constructor(options: Options) {
		this.configApi = options.configApi;
		this.errorApi = options.errorApi;
		this.catalogApi = options.catalogApi;
		this.host = this.configApi.getString('app.analytics.generic.host');
		this.endpoint = this.host;
		this.identityApi = options.identityApi;

		this.debug =
			this.configApi.getOptionalBoolean('app.analytics.generic.debug') === true;
		const configFlushIntervalMinutes = this.configApi.getOptionalNumber(
			'app.analytics.generic.interval'
		);
		this.flushInterval =
			configFlushIntervalMinutes !== null &&
			configFlushIntervalMinutes !== undefined
				? configFlushIntervalMinutes * 60 * 1000
				: 30 * 60 * 1000; // Default to 30 minutes if not specified
		this.basicAuthToken = this.configApi.getOptionalString(
			'app.analytics.generic.basicAuthToken'
		);
		if (this.flushInterval === 0) {
			this.captureEvent = this.instantCaptureEvent;
		} else {
			this.startFlushCycle();
		}
	}

	static fromConfig(
		config: ConfigApi,
		errorApi: ErrorApi,
		identityApi: IdentityApi,
		catalogApi: CatalogApi
	) {
		return new GenericAnalyticsAPI({
			configApi: config,
			errorApi: errorApi,
			identityApi,
			catalogApi,
		});
	}

	private log(message: string, isError: boolean = false): void {
		if (this.debug) {
			if (isError) {
				console.error(message);
			} else {
				console.log(message);
			}
		}
	}

	async captureEvent(event: AnalyticsEvent) {
		const user = await this.getUser();
		if (user) {
		} else {
			this.log('Error: user is undefined.');
			return;
		}

		const teamMetadata = await this.catalogApi.getEntityByRef(user);
		// const teamMetadata = await this.getGroup(user);

		this.log(
			'Capturing event: ' +
				JSON.stringify(event) +
				' User ID: ' +
				user +
				' Team Metadata: ' +
				teamMetadata
		);

		this.eventQueue.push({
			event,
			timestamp: new Date(),
			user: user,
			teamMetadata: teamMetadata,
		});

		if (this.flushInterval === 0) {
			const eventToFlush = this.eventQueue.pop();
			if (eventToFlush) {
				this.flushEvents([eventToFlush]);
			}
		}
	}

	private async getUser(): Promise<string | undefined> {
		if (this.identityApi) {
			const identity = await this.identityApi.getBackstageIdentity();
			return identity?.userEntityRef;
		}
		return undefined;
	}

	// private async getGroup(user: string): Promise<Entity> {
	// try {
	// const entity: Entity = await this.catalogApi.getEntityByRef(user);

	// const [entityType, rest] = user.split(':');
	// const [entityNamespace, entityName] = rest.split('/');

	// const entity: Entity = await this.catalogApi.getEntityByName({
	// kind: entityType,
	// namespace: entityNamespace,
	// name: entityName,
	// });

	// return entity;
	// } catch (error) {
	// console.error('Failed to fetch entity ancestry:', error);
	// }
	// }

	private async instantCaptureEvent(event: AnalyticsEvent) {
		const user = await this.getUser();
		if (!user) {
			this.log('Error: user is undefined.');
			return;
		}

		const teamMetadata = await this.catalogApi.getEntityByRef(user);
		// const teamMetadata = await this.getGroup(user);

		this.log(
			'Capturing event: ' +
				JSON.stringify(event) +
				' User ID: ' +
				user +
				' Team Metadata: ' +
				teamMetadata
		);

		const eventWithTimestamp = {
			event,
			timestamp: new Date(),
			user: user,
			teamMetadata,
		};

		await this.flushEvents([eventWithTimestamp]);
	}

	private startFlushCycle() {
		setInterval(async () => {
			if (this.eventQueue.length > 0) {
				this.flushEvents(this.eventQueue.splice(0));
			}
		}, this.flushInterval);
		this.log(`Starting flush cycle with interval: ${this.flushInterval}ms`);
	}

	private async flushEvents(
		events: {
			event: AnalyticsEvent;
			timestamp: Date;
			user?: string;
			teamMetadata?: Entity;
		}[]
	) {
		if (events.length === 0) {
			this.log('No events to flush.');
			return;
		}

		this.log(`Flushing ${events.length} events to endpoint: ${this.endpoint}`);

		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (this.basicAuthToken) {
				headers['Authorization'] = `Basic ${this.basicAuthToken}`;
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

			this.log('Successfully flushed events.');
		} catch (error) {
			this.log('Failed to flush analytics events', true);
			this.errorApi.post(
				new Error(`Failed to flush analytics events: ${error}`)
			);

			events.forEach((event) => {
				const eventId = JSON.stringify(event);
				const retries = this.eventRetryCounter.get(eventId) || 0;
				if (retries < this.retryLimit) {
					this.eventQueue.push(event);
					this.eventRetryCounter.set(eventId, retries + 1);
					this.log(`Retrying event: ${eventId}, attempt ${retries + 1}`, true);
				} else {
					this.log(`Max retries reached for event: ${eventId}`, true);
					this.errorApi.post(
						new Error(`Max retries reached for event: ${eventId}`)
					);
				}
			});
		}
	}
}
