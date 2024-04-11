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
	private readonly errorApi: ErrorApi;
	private readonly identityApi: IdentityApi;
	private readonly catalogApi: CatalogApi;
	private readonly host: string;
	private readonly endpoint: string;
	private eventQueue: {
		event: AnalyticsEvent;
		timestamp: Date;
		userId?: string;
		teamMetadata?: Entity[];
	}[] = [];
	private flushInterval: number;
	private basicAuthToken?: string;
	private retryLimit: number = 3;
	private eventRetryCounter: Map<string, number> = new Map();
	private debug: boolean;

	constructor(options: Options) {
		this.configApi = options.configApi;
		this.errorApi = options.errorApi;
		this.identityApi = options.identityApi;
		this.catalogApi = options.catalogApi;
		this.host = this.configApi.getString('app.analytics.generic.host');
		this.endpoint = this.host;
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
		const userId = await this.getUserId();
		if (!userId) {
			this.log('Error: userId is undefined.');
			return;
		}

		const teamEntity = await this.getUserEntity(userId);
		if (!teamEntity) {
			this.log('Error: teamEntity is undefined.');
			return;
		}

		let teamMetadata: Entity[] | undefined;

		try {
			teamMetadata = await this.getTeamEntities(userId);
			if (!teamMetadata || teamMetadata.length === 0) {
				throw new Error(
					`teamEntity is undefined or lacks a name for userId: ${userId}`
				);
			}
		} catch (error) {
			this.log(`Error retrieving team metadata: ${error}`, true);
			teamMetadata = [];
		}

		this.log(
			'Capturing event: ' +
				JSON.stringify(event) +
				' User ID: ' +
				userId +
				' Team Metadata: ' +
				(teamMetadata.length > 0 ? JSON.stringify(teamMetadata) : 'None')
		);

		this.eventQueue.push({
			event,
			timestamp: new Date(),
			userId,
			teamMetadata: teamMetadata.length > 0 ? teamMetadata : undefined,
		});

		if (this.flushInterval === 0) {
			const eventToFlush = this.eventQueue.pop();
			if (eventToFlush) {
				this.flushEvents([eventToFlush]);
			}
		}
	}

	private async getUserId(): Promise<string | undefined> {
		if (this.identityApi) {
			const identity = await this.identityApi.getBackstageIdentity();
			return identity?.userEntityRef;
		}
		return undefined;
	}

	private async getUserEntity(userId: string): Promise<Entity | undefined> {
		try {
			const { items: users } = await this.catalogApi.getEntities({
				filter: { 'metadata.name': userId },
			});
			return users[0];
		} catch (error) {
			this.log(
				`Error retrieving user entity for userId: ${userId} - ${error}`,
				true
			);
			return undefined;
		}
	}

	private async getTeamEntities(userId: string): Promise<Entity[]> {
		const userEntity = await this.getUserEntity(userId);
		if (!userEntity || !userEntity.relations) {
			this.log(
				`User entity not found or lacks relations for user ID: ${userId}`
			);
			return [];
		}

		const teamRefs = userEntity.relations
			.filter((relation) => relation.type === 'memberOf')
			.map((relation) => relation.targetRef);

		if (!teamRefs) {
			this.log(`Teams ref not found for ${userId}`);
			return [];
		}

		const { items: teamEntities } = await this.catalogApi.getEntitiesByRefs({
			entityRefs: teamRefs,
		});

		return teamEntities.filter((entity) => entity !== undefined) as Entity[];
	}

	private async instantCaptureEvent(event: AnalyticsEvent) {
		const userId = await this.getUserId();
		if (!userId) {
			this.log('Error: userId is undefined.');
			return;
		}

		const teamEntity = await this.getUserEntity(userId);
		if (!teamEntity) {
			this.log('Error: teamEntity is undefined.');
			return;
		}

		const eventWithTimestamp = {
			event,
			timestamp: new Date(),
			userId,
			teamEntity,
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
			userId?: string;
			teamMetadata?: Entity[];
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
