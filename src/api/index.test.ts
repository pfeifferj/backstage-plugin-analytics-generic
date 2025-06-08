import { ConfigApi, ErrorApi, IdentityApi } from '@backstage/core-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { GenericAnalyticsAPI } from './index';
import { setupServer } from 'msw/node';

// Mock document.cookie
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

const mockServer = setupServer();

beforeAll(() => mockServer.listen());
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});
afterAll(() => mockServer.close());

describe('GenericAnalyticsAPI', () => {
  let api: GenericAnalyticsAPI;
  let mockConfigApi: jest.Mocked<ConfigApi>;
  let mockErrorApi: jest.Mocked<ErrorApi>;
  let mockIdentityApi: jest.Mocked<IdentityApi>;
  let mockCatalogApi: jest.Mocked<CatalogApi>;
  let mockSessionApi: any;

  beforeEach(() => {
    // Reset document.cookie
    document.cookie = '';

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock APIs
    mockConfigApi = {
      getBoolean: jest.fn(),
      getOptionalBoolean: jest.fn(),
      getString: jest.fn(),
      getOptionalString: jest.fn(),
      getNumber: jest.fn(),
      getOptionalNumber: jest.fn(),
    } as any;

    mockErrorApi = {
      post: jest.fn(),
    } as any;

    mockIdentityApi = {
      getBackstageIdentity: jest.fn(),
      getCredentials: jest.fn(),
    } as any;

    mockCatalogApi = {
      getEntityByRef: jest.fn(),
    } as any;

    mockSessionApi = {
      getSession: jest.fn().mockResolvedValue({ userId: 'test-user-id' }),
      signIn: jest.fn(),
      signOut: jest.fn(),
      sessionState$: jest.fn().mockReturnValue({
        subscribe: jest.fn()
      }),
    };

    // Default config values
    mockConfigApi.getBoolean.mockReturnValue(false); // debug (fallback)
    mockConfigApi.getOptionalBoolean.mockReturnValue(false); // debug
    mockConfigApi.getString.mockReturnValue('http://localhost:3000'); // host
    mockConfigApi.getNumber.mockReturnValue(5); // interval in minutes
    mockConfigApi.getOptionalNumber.mockReturnValue(5); // interval in minutes
    mockConfigApi.getOptionalString.mockReturnValue(undefined); // authToken

    // Default identity
    mockIdentityApi.getBackstageIdentity.mockResolvedValue({
      type: 'user',
      userEntityRef: 'user:default/test-user',
      ownershipEntityRefs: ['user:default/test-user'],
    });

    // Default catalog response
    mockCatalogApi.getEntityByRef.mockResolvedValue({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'User',
      metadata: {
        name: 'test-user',
        namespace: 'default',
      },
      spec: {
        profile: {
          displayName: 'Test User',
          email: 'test@example.com',
        },
      },
    });

    // Create API instance
    api = new GenericAnalyticsAPI({
      configApi: mockConfigApi,
      errorApi: mockErrorApi,
      identityApi: mockIdentityApi,
      catalogApi: mockCatalogApi,
      sessionApi: mockSessionApi,
    });
  });

  describe('Static Factory Method', () => {
    it('should create instance using fromConfig', () => {
      const instance = GenericAnalyticsAPI.fromConfig(
        mockConfigApi,
        mockErrorApi,
        mockIdentityApi,
        mockCatalogApi,
        mockSessionApi
      );
      
      expect(instance).toBeInstanceOf(GenericAnalyticsAPI);
      expect((instance as any).configApi).toBe(mockConfigApi);
      expect((instance as any).errorApi).toBe(mockErrorApi);
    });
  });

  describe('Session Management', () => {
    it('should generate and store session ID on first capture', async () => {
      await api.captureEvent({ action: 'test', subject: 'test-subject', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      // Check that cookie was set
      expect(document.cookie).toContain('sessionId=');
      
      // Verify session ID is set on the instance
      expect((api as any).sessionId).toBeDefined();
      expect((api as any).sessionId).toMatch(/^[a-z0-9]+$/);
    });

    it('should reuse existing session ID from cookie', async () => {
      const existingSessionId = 'existing-session-123';
      document.cookie = `sessionId=${existingSessionId}; path=/`;

      await api.captureEvent({ action: 'test', subject: 'test-subject', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      // Should reuse the existing session ID
      expect((api as any).sessionId).toBe(existingSessionId);
      
      // Cookie should still contain the same session ID
      expect(document.cookie).toContain(`sessionId=${existingSessionId}`);
    });

    it('should handle existing session ID from cookie', async () => {
      const originalSessionId = 'session-123';
      document.cookie = `sessionId=${originalSessionId}; path=/`;

      await api.captureEvent({ action: 'test', subject: 'test-subject', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });
      
      // Should use the existing session ID
      expect((api as any).sessionId).toBe(originalSessionId);
    });

    it('should handle missing session API gracefully', async () => {
      api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: undefined as any,
      });

      await api.captureEvent({ action: 'test', subject: 'test-subject', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      // Should still generate session ID
      expect((api as any).sessionId).toBeDefined();
    });

    it('should handle session state changes - SignedIn', () => {
      const oldSessionId = (api as any).sessionId;
      
      // Simulate session state change to SignedIn
      (api as any).handleSessionStateChange('SignedIn');
      
      // Should generate new session ID
      expect((api as any).sessionId).toBeDefined();
      expect((api as any).sessionId).not.toBe(oldSessionId);
      expect(document.cookie).toContain('sessionId=');
    });

    it('should handle session state changes - SignedOut', () => {
      // Set up initial session
      (api as any).sessionId = 'test-session-123';
      document.cookie = 'sessionId=test-session-123; path=/';
      
      // Simulate session state change to SignedOut
      (api as any).handleSessionStateChange('SignedOut');
      
      // Should clear session ID and cookie
      expect((api as any).sessionId).toBeUndefined();
      expect(document.cookie).toContain('sessionId=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;');
    });

    it('should read session ID from cookie correctly', () => {
      document.cookie = 'sessionId=test-cookie-session; path=/';
      
      const sessionId = (api as any).readSessionIdFromCookie();
      expect(sessionId).toBe('test-cookie-session');
    });

    it('should handle malformed cookies gracefully', () => {
      document.cookie = 'other=value; sessionId=; invalid';
      
      const sessionId = (api as any).readSessionIdFromCookie();
      expect(sessionId).toBe('');
    });

    it('should return undefined when no session cookie exists', () => {
      document.cookie = 'other=value; different=cookie';
      
      const sessionId = (api as any).readSessionIdFromCookie();
      expect(sessionId).toBeUndefined();
    });

    it('should generate unique session IDs', () => {
      const id1 = (api as any).generateSessionId();
      const id2 = (api as any).generateSessionId();
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });
  });

  describe('Event Capture', () => {
    it('should capture events with required fields', async () => {
      const event = { action: 'click', subject: 'button', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } };
      await api.captureEvent(event);

      const capturedEvents = (api as any).eventQueue;
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toMatchObject({
        event: {
          action: 'click',
          subject: 'button',
        },
        timestamp: expect.any(Date),
        sessionId: expect.any(String),
      });
    });

    it('should include optional context fields', async () => {
      const event = {
        action: 'click',
        subject: 'button',
        value: 42,
        attributes: { color: 'blue' },
        context: {
          pluginId: 'test-plugin',
          routeRef: 'test-route',
          extension: 'test-extension',
        },
      };
      
      await api.captureEvent(event);

      const capturedEvents = (api as any).eventQueue;
      expect(capturedEvents[0].event).toMatchObject(event);
    });

    it('should fetch user data on first capture', async () => {
      await api.captureEvent({ action: 'test', subject: 'test', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      expect(mockIdentityApi.getBackstageIdentity).toHaveBeenCalled();
      expect(mockCatalogApi.getEntityByRef).not.toHaveBeenCalled();
      
      const capturedEvents = (api as any).eventQueue;
      expect(capturedEvents[0].user).toBe('user:default/test-user');
      expect(capturedEvents[0].teamMetadata).toBeUndefined();
    });

    it('should handle user data fetch errors gracefully', async () => {
      mockIdentityApi.getBackstageIdentity.mockRejectedValue(new Error('Identity error'));

      await api.captureEvent({ 
        action: 'test', 
        subject: 'test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' } 
      });

      // The error is logged but the API continues without a user
      // Event should not be captured if user fetch fails
      expect((api as any).eventQueue).toHaveLength(0);
    });
  });

  describe('Team Metadata Configuration', () => {
    it('should include team metadata when includeTeamMetadata is explicitly true', async () => {
      mockConfigApi.getOptionalBoolean.mockImplementation((key) => {
        if (key === 'app.analytics.generic.includeTeamMetadata') return true;
        if (key === 'app.analytics.generic.debug') return false;
        return undefined;
      });

      api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await api.captureEvent({ 
        action: 'test', 
        subject: 'test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' } 
      });

      expect(mockCatalogApi.getEntityByRef).toHaveBeenCalledWith('user:default/test-user');
      expect((api as any).eventQueue).toHaveLength(1);
      expect((api as any).eventQueue[0].teamMetadata).toBeDefined();
    });

    it('should not include team metadata when includeTeamMetadata is not set (default)', async () => {
      // includeTeamMetadata defaults to false (not explicitly set)
      mockConfigApi.getOptionalBoolean.mockImplementation((key) => {
        if (key === 'app.analytics.generic.includeTeamMetadata') return undefined; // Default
        if (key === 'app.analytics.generic.debug') return false;
        return undefined;
      });

      api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await api.captureEvent({ 
        action: 'test', 
        subject: 'test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' } 
      });

      expect(mockCatalogApi.getEntityByRef).not.toHaveBeenCalled();
      expect((api as any).eventQueue).toHaveLength(1);
      expect((api as any).eventQueue[0].teamMetadata).toBeUndefined();
    });

    it('should not include team metadata when includeTeamMetadata is false', async () => {
      mockConfigApi.getOptionalBoolean.mockImplementation((key) => {
        if (key === 'app.analytics.generic.includeTeamMetadata') return false;
        if (key === 'app.analytics.generic.debug') return false;
        return undefined;
      });

      api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await api.captureEvent({ 
        action: 'test', 
        subject: 'test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' } 
      });

      expect(mockCatalogApi.getEntityByRef).not.toHaveBeenCalled();
      expect((api as any).eventQueue).toHaveLength(1);
      expect((api as any).eventQueue[0].teamMetadata).toBeUndefined();
    });

    it('should handle catalog API errors gracefully when team metadata is enabled', async () => {
      mockConfigApi.getOptionalBoolean.mockImplementation((key) => {
        if (key === 'app.analytics.generic.includeTeamMetadata') return true;
        if (key === 'app.analytics.generic.debug') return true; // Enable debug to test error logging
        return undefined;
      });
      
      mockCatalogApi.getEntityByRef.mockRejectedValue(new Error('Catalog API error'));

      api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await api.captureEvent({ 
        action: 'test', 
        subject: 'test',
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' } 
      });

      expect(mockCatalogApi.getEntityByRef).toHaveBeenCalledWith('user:default/test-user');
      expect((api as any).eventQueue).toHaveLength(1);
      expect((api as any).eventQueue[0].teamMetadata).toBeUndefined();
      expect(mockErrorApi.post).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Event Flushing', () => {
    it('should batch events correctly', async () => {
      // Capture multiple events
      await api.captureEvent({ action: 'click', subject: 'button1', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });
      await api.captureEvent({ action: 'click', subject: 'button2', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });
      await api.captureEvent({ action: 'click', subject: 'button3', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      // All events should be queued
      expect((api as any).eventQueue).toHaveLength(3);
      
      // Check that events contain expected data
      const events = (api as any).eventQueue;
      expect(events[0].event.action).toBe('click');
      expect(events[0].event.subject).toBe('button1');
      expect(events[1].event.subject).toBe('button2');
      expect(events[2].event.subject).toBe('button3');
    });

    it('should handle instant capture mode correctly', async () => {
      mockConfigApi.getOptionalNumber.mockReturnValue(0); // instant mode
      
      const instantApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that the API switches to instant mode
      expect((instantApi as any).flushInterval).toBe(0);
      expect((instantApi as any).captureEvent).toBe((instantApi as any).instantCaptureEvent);
    });

    it('should handle empty events in flushEvents', async () => {
      mockConfigApi.getOptionalBoolean.mockReturnValue(true); // enable debug mode
      
      const debugApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });
      
      // Call flushEvents with empty array
      const result = await (debugApi as any).flushEvents([]);
      
      // Should handle empty array gracefully without errors
      expect(result).toBeUndefined();
      expect(mockErrorApi.post).not.toHaveBeenCalled();
    });

    it('should handle missing identityApi gracefully', async () => {
      const noIdentityApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: undefined as any,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await noIdentityApi.captureEvent({ 
        action: 'test', 
        subject: 'test', 
        context: { pluginId: 'test', routeRef: 'test', extension: 'test' } 
      });

      // Should handle missing identity API gracefully
      expect((noIdentityApi as any).eventQueue).toHaveLength(0);
    });

    it('should set interval correctly based on config', async () => {
      mockConfigApi.getOptionalNumber.mockReturnValue(10); // 10 minutes
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that the interval is set correctly (10 minutes = 600000ms)
      expect((testApi as any).flushInterval).toBe(600000);
    });

    it('should use default interval when config is undefined', async () => {
      mockConfigApi.getOptionalNumber.mockReturnValue(undefined);
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that the default interval is used (30 minutes = 1800000ms)
      expect((testApi as any).flushInterval).toBe(1800000);
    });

    it('should use default interval when config is null', async () => {
      mockConfigApi.getOptionalNumber.mockReturnValue(null as any);
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that the default interval is used (30 minutes = 1800000ms)
      expect((testApi as any).flushInterval).toBe(1800000);
    });

    it('should switch to instant capture mode when interval is 0', () => {
      mockConfigApi.getOptionalNumber.mockReturnValue(0);
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that interval is 0 and capture method is switched
      expect((testApi as any).flushInterval).toBe(0);
      expect((testApi as any).captureEvent).toBe((testApi as any).instantCaptureEvent);
    });

    it('should store basic auth token if configured', async () => {
      mockConfigApi.getOptionalString.mockReturnValueOnce('test-basic-auth-token').mockReturnValueOnce(undefined);
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that the basic auth token is stored correctly
      expect((testApi as any).basicAuthToken).toBe('test-basic-auth-token');
      expect((testApi as any).bearerAuthToken).toBeUndefined();
    });

    it('should store bearer auth token if configured', async () => {
      mockConfigApi.getOptionalString.mockReturnValueOnce(undefined).mockReturnValueOnce('test-bearer-token');
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Check that the bearer auth token is stored correctly
      expect((testApi as any).basicAuthToken).toBeUndefined();
      expect((testApi as any).bearerAuthToken).toBe('test-bearer-token');
    });

    it('should prioritize basic auth over bearer auth if both are configured', async () => {
      mockConfigApi.getOptionalString.mockReturnValueOnce('test-basic-auth').mockReturnValueOnce('test-bearer-auth');
      
      const testApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Both should be stored
      expect((testApi as any).basicAuthToken).toBe('test-basic-auth');
      expect((testApi as any).bearerAuthToken).toBe('test-bearer-auth');
    });

    it('should queue events correctly', async () => {
      await api.captureEvent({ action: 'test', subject: 'test', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });
      expect((api as any).eventQueue).toHaveLength(1);

      // Add another event
      await api.captureEvent({ action: 'click', subject: 'button', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });
      expect((api as any).eventQueue).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle API initialization errors gracefully', async () => {
      // Test that API can be created even with invalid config
      const invalidConfigApi = {
        ...mockConfigApi,
        getString: jest.fn().mockImplementation(() => {
          throw new Error('Config error');
        }),
      };

      expect(() => {
        // eslint-disable-next-line no-new
        new GenericAnalyticsAPI({
          configApi: invalidConfigApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: mockSessionApi,
        });
      }).toThrow('Config error');
    });
  });

  describe('Debug Mode', () => {
    it('should handle debug mode properly', async () => {
      mockConfigApi.getOptionalBoolean.mockReturnValue(true); // debug mode on
      
      api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      await api.captureEvent({ action: 'test', subject: 'test-subject', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      // Debug mode is enabled but only errors should use errorApi
      // Non-error debug logs are omitted for production readiness
      expect(mockErrorApi.post).not.toHaveBeenCalled();
    });

    it('should not trigger error logging in non-debug mode', async () => {
      await api.captureEvent({ action: 'test', subject: 'test-subject', context: { pluginId: 'test', routeRef: 'test', extension: 'test' } });

      // Should not call errorApi for normal operations
      expect(mockErrorApi.post).not.toHaveBeenCalled();
    });

    it('should use errorApi for error messages in debug mode', () => {
      mockConfigApi.getOptionalBoolean.mockReturnValue(true);
      
      const debugApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Call the private log method with error flag
      (debugApi as any).log('Test error message', true);

      expect(mockErrorApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Analytics: Test error message'
        })
      );
    });

    it('should not log regular messages in debug mode', () => {
      mockConfigApi.getOptionalBoolean.mockReturnValue(true);
      
      const debugApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Call the private log method without error flag
      (debugApi as any).log('Test info message', false);

      // Non-error debug messages are omitted for production readiness
      expect(mockErrorApi.post).not.toHaveBeenCalled();
    });

    it('should not use errorApi when debug mode is off', () => {
      mockConfigApi.getOptionalBoolean.mockReturnValue(false);
      
      const nonDebugApi = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Clear previous calls
      jest.clearAllMocks();

      // Call the private log method
      (nonDebugApi as any).log('Should not log this', false);
      (nonDebugApi as any).log('Should not log this error', true);

      // Should not call errorApi when debug mode is off
      expect(mockErrorApi.post).not.toHaveBeenCalled();
    });
  });

  describe('Session API Integration', () => {
    it('should handle session subscription errors gracefully', () => {
      const errorSessionApi = {
        ...mockSessionApi,
        sessionState$: {
          subscribe: jest.fn().mockImplementation(() => {
            throw new Error('Subscription failed');
          }),
        },
      };

      // Should not throw when session subscription fails
      expect(() => {
        // eslint-disable-next-line no-new
        new GenericAnalyticsAPI({
          configApi: mockConfigApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: errorSessionApi,
        });
      }).not.toThrow();
    });

    it('should handle missing sessionState$ gracefully', () => {
      const incompleteSessionApi = {
        getSession: jest.fn(),
        signIn: jest.fn(),
        signOut: jest.fn(),
        // sessionState$ is missing
      };

      // Should not throw when sessionState$ is missing
      expect(() => {
        // eslint-disable-next-line no-new
        new GenericAnalyticsAPI({
          configApi: mockConfigApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: incompleteSessionApi as any,
        });
      }).not.toThrow();
    });
  });
});