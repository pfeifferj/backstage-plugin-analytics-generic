import { ConfigApi, ErrorApi, IdentityApi } from '@backstage/core-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { GenericAnalyticsAPI } from './index';

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

describe('GenericAnalyticsAPI Property-Based Tests', () => {
  let mockConfigApi: jest.Mocked<ConfigApi>;
  let mockErrorApi: jest.Mocked<ErrorApi>;
  let mockIdentityApi: jest.Mocked<IdentityApi>;
  let mockCatalogApi: jest.Mocked<CatalogApi>;
  let mockSessionApi: any;

  beforeEach(() => {
    document.cookie = '';
    
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    mockConfigApi = {
      getBoolean: jest.fn(),
      getOptionalBoolean: jest.fn().mockReturnValue(false),
      getString: jest.fn().mockReturnValue('http://localhost:3000'),
      getOptionalString: jest.fn().mockReturnValue(undefined),
      getNumber: jest.fn(),
      getOptionalNumber: jest.fn().mockReturnValue(0), // instant mode
    } as any;

    mockErrorApi = {
      post: jest.fn(),
    } as any;

    mockIdentityApi = {
      getBackstageIdentity: jest.fn().mockResolvedValue({
        type: 'user',
        userEntityRef: 'user:default/test-user',
        ownershipEntityRefs: ['user:default/test-user'],
      }),
      getCredentials: jest.fn(),
    } as any;

    mockCatalogApi = {
      getEntityByRef: jest.fn().mockResolvedValue({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: {
          name: 'test-user',
          namespace: 'default',
        },
      }),
    } as any;

    mockSessionApi = {
      getSession: jest.fn().mockResolvedValue({ userId: 'test-user-id' }),
      signIn: jest.fn(),
      signOut: jest.fn(),
      sessionState$: jest.fn().mockReturnValue({
        subscribe: jest.fn(),
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Session ID Generation Properties', () => {
    it('should always generate unique session IDs', () => {
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const sessionIds = new Set<string>();
      
      // Generate 100 session IDs
      for (let i = 0; i < 100; i++) {
        const sessionId = (api as any).generateSessionId();
        sessionIds.add(sessionId);
      }

      // All generated session IDs should be unique
      expect(sessionIds.size).toBe(100);
    });

    it('should always generate valid session ID format', () => {
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Test multiple generations
      for (let i = 0; i < 50; i++) {
        const sessionId = (api as any).generateSessionId();
        
        expect(typeof sessionId).toBe('string');
        expect(sessionId.length).toBeGreaterThan(0);
        expect(sessionId.trim()).toBe(sessionId); // No leading/trailing whitespace
        expect(/^[a-z0-9]+$/.test(sessionId)).toBe(true); // Only alphanumeric characters
        expect(sessionId.length).toBeGreaterThanOrEqual(10);
        expect(sessionId.length).toBeLessThanOrEqual(50);
      }
    });

    it('should handle various cookie formats', () => {
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const testCases = [
        { input: 'sessionId=abc123', expected: 'abc123' },
        { input: 'sessionId=xyz789; path=/', expected: 'xyz789' },
        { input: 'other=value; sessionId=test123; more=data', expected: 'test123' },
        { input: '', expected: undefined },
        { input: 'other=value', expected: undefined },
        { input: 'sessionId=', expected: '' },
      ];

      testCases.forEach(({ input, expected }) => {
        document.cookie = input;
        const result = (api as any).readSessionIdFromCookie();
        expect(result).toBe(expected);
      });
    });

    it('should handle malformed cookies gracefully', () => {
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const malformedInputs = [
        '%', // Invalid URI encoding
        'sessionId=%ZZ', // Invalid hex
        'sessionId=value%', // Incomplete encoding
        'invalid format',
        ';;;;',
      ];

      malformedInputs.forEach(input => {
        document.cookie = input;
        
        // Should not throw an error
        expect(() => {
          const result = (api as any).readSessionIdFromCookie();
          // Result should be undefined for malformed cookies
          expect(result === undefined || result === '').toBe(true);
        }).not.toThrow();
      });
    });
  });

  describe('Configuration Properties', () => {
    it('should handle various flush interval configurations', () => {
      const testCases = [
        { input: undefined, expected: 1800000 }, // 30 minutes default
        { input: null, expected: 1800000 }, // 30 minutes default
        { input: 0, expected: 0 }, // instant mode
        { input: 1, expected: 60000 }, // 1 minute
        { input: 10, expected: 600000 }, // 10 minutes
        { input: 1440, expected: 86400000 }, // 24 hours
      ];

      testCases.forEach(({ input, expected }) => {
        const configApi = {
          ...mockConfigApi,
          getOptionalNumber: jest.fn().mockReturnValue(input),
        };

        const api = new GenericAnalyticsAPI({
          configApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: mockSessionApi,
        });

        expect((api as any).flushInterval).toBe(expected);
      });
    });

    it('should handle various debug configuration values', () => {
      const testCases = [
        { input: undefined, expected: false },
        { input: null, expected: false },
        { input: false, expected: false },
        { input: true, expected: true },
      ];

      testCases.forEach(({ input, expected }) => {
        const configApi = {
          ...mockConfigApi,
          getOptionalBoolean: jest.fn().mockReturnValue(input),
        };

        const api = new GenericAnalyticsAPI({
          configApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: mockSessionApi,
        });

        expect((api as any).debug).toBe(expected);
      });
    });
  });

  describe('Event Handling Properties', () => {
    it('should handle valid event structures without throwing', async () => {
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const validEvents = [
        {
          action: 'click',
          subject: 'button',
          context: { pluginId: 'test', routeRef: 'test', extension: 'test' }
        },
        {
          action: 'view',
          subject: 'page',
          context: { pluginId: 'catalog', routeRef: 'catalog', extension: 'catalog' },
          value: 42
        },
        {
          action: 'search',
          subject: 'query',
          context: { pluginId: 'search', routeRef: 'search', extension: 'search' },
          attributes: { query: 'test', results: 5 }
        },
      ];

      for (const event of validEvents) {
        await expect(api.captureEvent(event as any)).resolves.not.toThrow();
      }
    });
  });
});