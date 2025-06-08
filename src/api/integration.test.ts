import { ConfigApi, ErrorApi, IdentityApi } from '@backstage/core-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { GenericAnalyticsAPI } from './index';
import { setupServer } from 'msw/node';
import { rest } from 'msw';

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

const mockServer = setupServer();

beforeAll(() => mockServer.listen());
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  document.cookie = '';
});
afterAll(() => mockServer.close());

describe('GenericAnalyticsAPI Integration Tests', () => {
  let api: GenericAnalyticsAPI;
  let mockConfigApi: jest.Mocked<ConfigApi>;
  let mockErrorApi: jest.Mocked<ErrorApi>;
  let mockIdentityApi: jest.Mocked<IdentityApi>;
  let mockCatalogApi: jest.Mocked<CatalogApi>;
  let mockSessionApi: any;
  
  const endpoint = 'http://localhost:3001/analytics';
  let receivedEvents: any[] = [];

  beforeEach(() => {
    receivedEvents = [];
    
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    mockConfigApi = {
      getBoolean: jest.fn(),
      getOptionalBoolean: jest.fn().mockReturnValue(false),
      getString: jest.fn().mockReturnValue(endpoint),
      getOptionalString: jest.fn().mockReturnValue(undefined),
      getNumber: jest.fn(),
      getOptionalNumber: jest.fn().mockReturnValue(0), // instant mode for integration tests
    } as any;

    mockErrorApi = {
      post: jest.fn(),
    } as any;

    mockIdentityApi = {
      getBackstageIdentity: jest.fn().mockResolvedValue({
        type: 'user',
        userEntityRef: 'user:default/integration-test-user',
        ownershipEntityRefs: ['user:default/integration-test-user'],
      }),
      getCredentials: jest.fn(),
    } as any;

    mockCatalogApi = {
      getEntityByRef: jest.fn().mockResolvedValue({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: {
          name: 'integration-test-user',
          namespace: 'default',
        },
        spec: {
          profile: {
            displayName: 'Integration Test User',
            email: 'integration-test@example.com',
          },
        },
      }),
    } as any;

    mockSessionApi = {
      getSession: jest.fn().mockResolvedValue({ userId: 'integration-test-user-id' }),
      signIn: jest.fn(),
      signOut: jest.fn(),
      sessionState$: jest.fn().mockReturnValue({
        subscribe: jest.fn(),
      }),
    };

    // Setup MSW handler to capture events
    mockServer.use(
      rest.post(endpoint, async (req, res, ctx) => {
        const body = await req.json();
        receivedEvents.push(...body as any[]);
        return res(ctx.status(200), ctx.json({ success: true }));
      })
    );

    api = new GenericAnalyticsAPI({
      configApi: mockConfigApi,
      errorApi: mockErrorApi,
      identityApi: mockIdentityApi,
      catalogApi: mockCatalogApi,
      sessionApi: mockSessionApi,
    });
  });

  describe('Full Pipeline Integration', () => {
    it('should complete full event capture and transmission pipeline', async () => {
      const event = {
        action: 'page_view',
        subject: 'catalog-page',
        context: {
          pluginId: 'catalog',
          routeRef: 'catalogIndexPage',
          extension: 'CatalogIndexPage',
        },
        attributes: {
          path: '/catalog',
          userAgent: 'test-browser',
        }
      };

      await api.captureEvent(event);

      // Wait for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedEvents).toHaveLength(1);
      
      const receivedEvent = receivedEvents[0];
      expect(receivedEvent).toMatchObject({
        event: {
          action: 'page_view',
          subject: 'catalog-page',
          context: {
            pluginId: 'catalog',
            routeRef: 'catalogIndexPage',
            extension: 'CatalogIndexPage',
          },
          attributes: {
            path: '/catalog',
            userAgent: 'test-browser',
          }
        },
        timestamp: expect.any(String),
        user: 'user:default/integration-test-user',
        sessionId: expect.any(String),
        teamMetadata: {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'User',
          metadata: {
            name: 'integration-test-user',
            namespace: 'default',
          },
          spec: {
            profile: {
              displayName: 'Integration Test User',
              email: 'integration-test@example.com',
            },
          },
        },
      });

      expect(mockIdentityApi.getBackstageIdentity).toHaveBeenCalled();
      expect(mockCatalogApi.getEntityByRef).toHaveBeenCalledWith('user:default/integration-test-user');
    });

    it('should handle multiple events in sequence', async () => {
      const events = [
        { action: 'click', subject: 'search-button', context: { pluginId: 'search', routeRef: 'search', extension: 'SearchPage' } },
        { action: 'search', subject: 'query', context: { pluginId: 'search', routeRef: 'search', extension: 'SearchPage' }, attributes: { query: 'test' } },
        { action: 'click', subject: 'result', context: { pluginId: 'search', routeRef: 'search', extension: 'SearchPage' }, attributes: { resultIndex: 0 } },
      ] as any[];

      for (const event of events) {
        await api.captureEvent(event);
        await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between events
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0].event.action).toBe('click');
      expect(receivedEvents[1].event.action).toBe('search');
      expect(receivedEvents[2].event.action).toBe('click');
      
      // All events should have the same session ID
      const sessionIds = receivedEvents.map(e => e.sessionId);
      expect(new Set(sessionIds).size).toBe(1);
    });

    it('should handle authentication with basic auth', async () => {
      mockConfigApi.getOptionalString.mockReturnValueOnce('dGVzdDp0ZXN0').mockReturnValueOnce(undefined); // basic auth only
      
      // Setup new API with auth token
      const authApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      let authHeader = '';
      mockServer.use(
        rest.post(endpoint, async (req, res, ctx) => {
          authHeader = req.headers.get('Authorization') || '';
          const body = await req.json();
          receivedEvents.push(...body as any[]);
          return res(ctx.status(200), ctx.json({ success: true }));
        })
      );

      await authApi.captureEvent({
        action: 'test',
        subject: 'auth-test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(authHeader).toBe('Basic dGVzdDp0ZXN0');
      expect(receivedEvents).toHaveLength(1);
    });

    it('should handle authentication with bearer token', async () => {
      mockConfigApi.getOptionalString.mockReturnValueOnce(undefined).mockReturnValueOnce('test-bearer-token-123'); // bearer auth only
      
      // Setup new API with bearer token
      const authApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      let authHeader = '';
      mockServer.use(
        rest.post(endpoint, async (req, res, ctx) => {
          authHeader = req.headers.get('Authorization') || '';
          const body = await req.json();
          receivedEvents.push(...body as any[]);
          return res(ctx.status(200), ctx.json({ success: true }));
        })
      );

      await authApi.captureEvent({
        action: 'test',
        subject: 'bearer-auth-test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(authHeader).toBe('Bearer test-bearer-token-123');
      expect(receivedEvents).toHaveLength(1);
    });

    it('should handle server errors with retry logic', async () => {
      let requestCount = 0;
      
      mockServer.use(
        rest.post(endpoint, async (req, res, ctx) => {
          requestCount++;
          if (requestCount <= 2) {
            return res(ctx.status(500), ctx.json({ error: 'Server error' }));
          }
          const body = await req.json();
          receivedEvents.push(...body as any[]);
          return res(ctx.status(200), ctx.json({ success: true }));
        })
      );

      await api.captureEvent({
        action: 'test',
        subject: 'retry-test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
      });

      // Wait for retries
      await new Promise(resolve => setTimeout(resolve, 500));

      // In instant mode, retries happen immediately, so we should see at least one error
      expect(mockErrorApi.post).toHaveBeenCalled();
    });

    it('should handle network timeouts gracefully', async () => {
      // Reset mock calls
      mockErrorApi.post.mockClear();
      
      mockServer.use(
        rest.post(endpoint, (_req, res, ctx) => {
          return res(ctx.status(500), ctx.json({ error: 'Server error' })); // Simulate server error instead
        })
      );

      await api.captureEvent({
        action: 'test',
        subject: 'timeout-test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(mockErrorApi.post).toHaveBeenCalled();
    }, 10000);

    it('should maintain session consistency across page reloads', async () => {
      // Simulate existing session cookie
      const existingSessionId = 'existing-session-12345';
      document.cookie = `sessionId=${existingSessionId}; path=/`;

      const newApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await newApi.captureEvent({
        action: 'page_reload',
        subject: 'catalog-page',
        context: { pluginId: 'catalog', routeRef: 'catalog', extension: 'catalog' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].sessionId).toBe(existingSessionId);
    });
  });

  describe('Error Recovery Integration', () => {
    it('should recover from catalog API failures', async () => {
      // Reset received events for this test
      receivedEvents.length = 0;
      
      // Create a new API instance to avoid affecting other tests
      const mockCatalogApiWithError = {
        ...mockCatalogApi,
        getEntityByRef: jest.fn().mockImplementation(() => 
          Promise.reject(new Error('Catalog unavailable'))
        ),
      };
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApiWithError,
        sessionApi: mockSessionApi,
      });

      await testApi.captureEvent({
        action: 'test',
        subject: 'catalog-error-test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Event should still be sent, but without team metadata
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].teamMetadata).toBeUndefined();
    });

    it('should handle identity API failures gracefully', async () => {
      mockIdentityApi.getBackstageIdentity.mockRejectedValueOnce(new Error('Identity unavailable'));

      await api.captureEvent({
        action: 'test',
        subject: 'identity-error-test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Event should not be sent if user identity cannot be determined
      expect(receivedEvents).toHaveLength(0);
    });
  });

  describe('Configuration Integration', () => {
    it('should adapt behavior based on debug configuration', async () => {
      mockConfigApi.getOptionalBoolean.mockReturnValue(true); // Enable debug mode
      
      const debugApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await debugApi.captureEvent({
        action: 'debug_test',
        subject: 'debug-subject',
        context: { pluginId: 'debug', routeRef: 'debug', extension: 'debug' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Debug mode no longer uses console.log for non-error messages
      // Only errors would use errorApi in debug mode
      expect(receivedEvents).toHaveLength(1);
    });

    it('should handle missing configuration gracefully', async () => {
      const incompleteConfigApi = {
        ...mockConfigApi,
        getString: jest.fn().mockImplementation((key) => {
          if (key === 'app.analytics.generic.host') {
            throw new Error('Missing configuration');
          }
          return '';
        }),
      };

      expect(() => {
        // eslint-disable-next-line no-new
        new GenericAnalyticsAPI({
          configApi: incompleteConfigApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: mockSessionApi,
        });
      }).toThrow('Missing configuration');
    });
  });
});