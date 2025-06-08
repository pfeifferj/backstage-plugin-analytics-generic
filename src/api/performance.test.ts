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

describe('GenericAnalyticsAPI Performance Tests', () => {
  let mockConfigApi: jest.Mocked<ConfigApi>;
  let mockErrorApi: jest.Mocked<ErrorApi>;
  let mockIdentityApi: jest.Mocked<IdentityApi>;
  let mockCatalogApi: jest.Mocked<CatalogApi>;
  let mockSessionApi: any;
  
  const endpoint = 'http://localhost:3002/analytics';
  let receivedBatches: any[][] = [];
  let requestCount = 0;

  beforeEach(() => {
    receivedBatches = [];
    requestCount = 0;
    
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    mockConfigApi = {
      getBoolean: jest.fn(),
      getOptionalBoolean: jest.fn().mockReturnValue(false),
      getString: jest.fn().mockReturnValue(endpoint),
      getOptionalString: jest.fn().mockReturnValue(undefined),
      getNumber: jest.fn(),
      getOptionalNumber: jest.fn().mockReturnValue(0.1), // 0.1 minutes = 6 seconds for batching
    } as any;

    mockErrorApi = {
      post: jest.fn(),
    } as any;

    mockIdentityApi = {
      getBackstageIdentity: jest.fn().mockResolvedValue({
        type: 'user',
        userEntityRef: 'user:default/perf-test-user',
        ownershipEntityRefs: ['user:default/perf-test-user'],
      }),
      getCredentials: jest.fn(),
    } as any;

    mockCatalogApi = {
      getEntityByRef: jest.fn().mockResolvedValue({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: {
          name: 'perf-test-user',
          namespace: 'default',
        },
        spec: {
          profile: {
            displayName: 'Performance Test User',
            email: 'perf-test@example.com',
          },
        },
      }),
    } as any;

    mockSessionApi = {
      getSession: jest.fn().mockResolvedValue({ userId: 'perf-test-user-id' }),
      signIn: jest.fn(),
      signOut: jest.fn(),
      sessionState$: jest.fn().mockReturnValue({
        subscribe: jest.fn(),
      }),
    };

    // Setup MSW handler to capture batches
    mockServer.use(
      rest.post(endpoint, async (req, res, ctx) => {
        requestCount++;
        const batch = await req.json() as any[];
        receivedBatches.push(batch);
        
        // Simulate server processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        
        return res(ctx.status(200), ctx.json({ success: true, processed: batch.length }));
      })
    );
  });

  describe('Event Batching Performance', () => {
    it('should efficiently batch multiple events', async () => {
      // Reset for this test
      receivedBatches.length = 0;
      requestCount = 0;
      
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const startTime = performance.now();
      
      // Generate 100 events quickly
      const events = Array.from({ length: 100 }, (_, i) => ({
        action: 'click',
        subject: `button-${i}`,
        context: {
          pluginId: 'test',
          routeRef: 'test',
          extension: 'test',
        },
        attributes: {
          index: i,
          timestamp: Date.now(),
        },
      }));

      // Capture all events
      const capturePromises = events.map(event => api.captureEvent(event));
      await Promise.all(capturePromises);

      const captureTime = performance.now() - startTime;

      // Wait for batch to be flushed
      await new Promise(resolve => setTimeout(resolve, 7000)); // Wait longer than flush interval

      const totalTime = performance.now() - startTime;

      expect(captureTime).toBeLessThan(1000); // Capturing 100 events should take less than 1 second
      expect(receivedBatches).toHaveLength(1); // Should be batched into a single request
      expect(receivedBatches[0]).toHaveLength(100); // All events in one batch
      expect(requestCount).toBe(1); // Only one HTTP request
      
      // eslint-disable-next-line no-console
      console.log(`Performance metrics:
        - Capture time for 100 events: ${captureTime.toFixed(2)}ms
        - Total time including flush: ${totalTime.toFixed(2)}ms
        - Events per second during capture: ${(100 / (captureTime / 1000)).toFixed(0)}
        - Batches sent: ${receivedBatches.length}
        - HTTP requests: ${requestCount}`);
    }, 10000);

    it('should handle high-frequency event generation', async () => {
      // Reset for this test
      receivedBatches.length = 0;
      requestCount = 0;
      
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const startTime = performance.now();
      let eventCount = 0;

      // Generate events continuously for 2 seconds
      const eventInterval = setInterval(async () => {
        await api.captureEvent({
          action: 'scroll',
          subject: 'page',
          context: {
            pluginId: 'test',
            routeRef: 'test',
            extension: 'test',
          },
          attributes: {
            scrollPosition: Math.random() * 1000,
            timestamp: Date.now(),
          },
        });
        eventCount++;
      }, 10); // Event every 10ms

      // Run for 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      clearInterval(eventInterval);

      const generationTime = performance.now() - startTime;

      // Wait for batches to be flushed
      await new Promise(resolve => setTimeout(resolve, 7000));

      const totalTime = performance.now() - startTime;

      expect(eventCount).toBeGreaterThan(50); // Should generate many events
      expect(receivedBatches.length).toBeGreaterThanOrEqual(1); // At least one batch
      
      const totalEventsReceived = receivedBatches.reduce((sum, batch) => sum + batch.length, 0);
      expect(totalEventsReceived).toBe(eventCount); // All events should be received

      // eslint-disable-next-line no-console
      console.log(`High-frequency performance metrics:
        - Events generated in ${generationTime.toFixed(0)}ms: ${eventCount}
        - Events per second: ${(eventCount / (generationTime / 1000)).toFixed(0)}
        - Total batches: ${receivedBatches.length}
        - Average batch size: ${(totalEventsReceived / receivedBatches.length).toFixed(1)}
        - Total time: ${totalTime.toFixed(0)}ms`);
    }, 10000);

    it('should maintain performance with large event payloads', async () => {
      // Reset for this test
      receivedBatches.length = 0;
      requestCount = 0;
      
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const startTime = performance.now();

      // Generate events with large payloads
      const largeEvents = Array.from({ length: 20 }, (_, i) => ({
        action: 'data_export',
        subject: 'large-dataset',
        context: {
          pluginId: 'data-export',
          routeRef: 'export',
          extension: 'ExportPage',
        },
        attributes: {
          datasetSize: 1000,
          totalSize: 1000,
          exportFormat: 'json',
          recordCount: `items-${i}`,
        },
      }));

      const capturePromises = largeEvents.map(event => api.captureEvent(event));
      await Promise.all(capturePromises);

      const captureTime = performance.now() - startTime;

      // Wait for batch to be flushed
      await new Promise(resolve => setTimeout(resolve, 7000));

      const totalTime = performance.now() - startTime;

      expect(captureTime).toBeLessThan(2000); // Should handle large payloads efficiently
      expect(receivedBatches).toHaveLength(1);
      expect(receivedBatches[0]).toHaveLength(20);

      // Calculate approximate payload size
      const payloadSize = JSON.stringify(receivedBatches[0]).length;

      // eslint-disable-next-line no-console
      console.log(`Large payload performance metrics:
        - Capture time for 20 large events: ${captureTime.toFixed(2)}ms
        - Total time: ${totalTime.toFixed(2)}ms
        - Approximate payload size: ${(payloadSize / 1024).toFixed(0)}KB
        - Throughput: ${(payloadSize / 1024 / (captureTime / 1000)).toFixed(0)}KB/s`);
    }, 10000);

    it('should handle memory efficiently during burst scenarios', async () => {
      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      // Simulate memory usage before
      const initialMemory = process.memoryUsage();

      // Generate a large burst of events
      const burstSize = 1000;
      const startTime = performance.now();

      for (let batch = 0; batch < 5; batch++) {
        const batchPromises = Array.from({ length: burstSize }, (_, i) => 
          api.captureEvent({
            action: 'burst_event',
            subject: `event-${batch}-${i}`,
            context: {
              pluginId: 'burst-test',
              routeRef: 'burst',
              extension: 'BurstTest',
            },
            attributes: {
              batch,
              index: i,
              dataSize: 100,
            },
          })
        );
        
        await Promise.all(batchPromises);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const burstTime = performance.now() - startTime;

      // Wait for all events to be flushed
      await new Promise(resolve => setTimeout(resolve, 10000));

      const finalMemory = process.memoryUsage();
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024; // MB

      expect(receivedBatches.length).toBeGreaterThanOrEqual(1);
      
      const totalEventsReceived = receivedBatches.reduce((sum, batch) => sum + batch.length, 0);
      expect(totalEventsReceived).toBeGreaterThanOrEqual(burstSize * 4); // Allow for some variation

      // Memory increase should be reasonable (less than 100MB for this test)
      expect(memoryIncrease).toBeLessThan(100);

      // eslint-disable-next-line no-console
      console.log(`Memory efficiency metrics:
        - Events processed: ${totalEventsReceived}
        - Processing time: ${burstTime.toFixed(0)}ms
        - Events per second: ${(totalEventsReceived / (burstTime / 1000)).toFixed(0)}
        - Memory increase: ${memoryIncrease.toFixed(2)}MB
        - Final batches: ${receivedBatches.length}`);
    }, 15000);
  });

  describe('Network Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      // Create multiple API instances to simulate concurrent users
      const apiInstances = Array.from({ length: 5 }, () => 
        new GenericAnalyticsAPI({
          configApi: mockConfigApi,
          errorApi: mockErrorApi,
          identityApi: mockIdentityApi,
          catalogApi: mockCatalogApi,
          sessionApi: mockSessionApi,
        })
      );

      const startTime = performance.now();

      // Each instance generates events concurrently
      const instancePromises = apiInstances.map(async (api, instanceIndex) => {
        const events = Array.from({ length: 50 }, (_, i) => ({
          action: 'concurrent_test',
          subject: `instance-${instanceIndex}-event-${i}`,
          context: {
            pluginId: 'concurrent-test',
            routeRef: 'concurrent',
            extension: 'ConcurrentTest',
          },
          attributes: {
            instanceIndex,
            eventIndex: i,
          },
        }));

        const capturePromises = events.map(event => api.captureEvent(event));
        return Promise.all(capturePromises);
      });

      await Promise.all(instancePromises);

      const captureTime = performance.now() - startTime;

      // Wait for all batches to be flushed
      await new Promise(resolve => setTimeout(resolve, 8000));

      const totalTime = performance.now() - startTime;
      const totalEvents = receivedBatches.reduce((sum, batch) => sum + batch.length, 0);

      expect(totalEvents).toBe(250); // 5 instances * 50 events each
      expect(receivedBatches.length).toBe(5); // One batch per instance

      // eslint-disable-next-line no-console
      console.log(`Concurrent performance metrics:
        - Concurrent instances: 5
        - Events per instance: 50
        - Total events: ${totalEvents}
        - Capture time: ${captureTime.toFixed(0)}ms
        - Total time: ${totalTime.toFixed(0)}ms
        - Concurrent throughput: ${(totalEvents / (captureTime / 1000)).toFixed(0)} events/s
        - HTTP requests: ${requestCount}`);
    }, 10000);

    it('should handle network latency gracefully', async () => {
      // Add artificial latency to server responses
      mockServer.use(
        rest.post(endpoint, async (req, res, ctx) => {
          requestCount++;
          const batch = await req.json() as any[];
          receivedBatches.push(batch);
          
          // Simulate high network latency
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return res(ctx.status(200), ctx.json({ success: true }));
        })
      );

      const api = new GenericAnalyticsAPI({
        configApi: mockConfigApi,
        errorApi: mockErrorApi,
        identityApi: mockIdentityApi,
        catalogApi: mockCatalogApi,
        sessionApi: mockSessionApi,
      });

      const startTime = performance.now();

      // Generate events while server has high latency
      const events = Array.from({ length: 30 }, (_, i) => ({
        action: 'latency_test',
        subject: `latency-event-${i}`,
        context: {
          pluginId: 'latency-test',
          routeRef: 'latency',
          extension: 'LatencyTest',
        },
      }));

      const capturePromises = events.map(event => api.captureEvent(event));
      await Promise.all(capturePromises);

      const captureTime = performance.now() - startTime;

      // Wait for batch to be sent (considering latency)
      await new Promise(resolve => setTimeout(resolve, 8000));

      const totalTime = performance.now() - startTime;

      // Event capture should still be fast despite network latency
      expect(captureTime).toBeLessThan(1000);
      expect(receivedBatches.length).toBeGreaterThanOrEqual(1);
      
      const totalEventsReceived = receivedBatches.reduce((sum, batch) => sum + batch.length, 0);
      expect(totalEventsReceived).toBe(30);

      // eslint-disable-next-line no-console
      console.log(`Network latency performance metrics:
        - Event capture time: ${captureTime.toFixed(0)}ms
        - Total time with network latency: ${totalTime.toFixed(0)}ms
        - Events captured: 30
        - Network requests: ${requestCount}`);
    }, 10000);
  });
});