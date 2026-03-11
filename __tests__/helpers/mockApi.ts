/**
 * Test mock helper — creates a mock LateApiClient for all tool tests.
 * Instead of mocking the SDK module, we mock the client module to return
 * a fake LateApiClient with vi.fn() methods for every API endpoint.
 */
import { vi } from 'vitest';

export interface MockLateApiClient {
  // Profiles & Accounts
  listProfiles: ReturnType<typeof vi.fn>;
  listAccounts: ReturnType<typeof vi.fn>;
  getAccountHealth: ReturnType<typeof vi.fn>;
  getAllAccountsHealth: ReturnType<typeof vi.fn>;
  getUsageStats: ReturnType<typeof vi.fn>;

  // Posts
  listPosts: ReturnType<typeof vi.fn>;
  getPost: ReturnType<typeof vi.fn>;
  createPost: ReturnType<typeof vi.fn>;
  updatePost: ReturnType<typeof vi.fn>;
  deletePost: ReturnType<typeof vi.fn>;
  retryPost: ReturnType<typeof vi.fn>;
  unpublishPost: ReturnType<typeof vi.fn>;

  // Analytics
  getAnalytics: ReturnType<typeof vi.fn>;
  getDailyMetrics: ReturnType<typeof vi.fn>;
  getFollowerStats: ReturnType<typeof vi.fn>;
  getPostTimeline: ReturnType<typeof vi.fn>;
  getYouTubeDailyViews: ReturnType<typeof vi.fn>;

  // Queue
  listQueues: ReturnType<typeof vi.fn>;
  createQueue: ReturnType<typeof vi.fn>;
  updateQueue: ReturnType<typeof vi.fn>;
  deleteQueue: ReturnType<typeof vi.fn>;
  previewQueueSlots: ReturnType<typeof vi.fn>;

  // Engagement: Messages
  listConversations: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  listMessages: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  editMessage: ReturnType<typeof vi.fn>;

  // Engagement: Comments
  listCommentedPosts: ReturnType<typeof vi.fn>;
  getPostComments: ReturnType<typeof vi.fn>;
  replyToComment: ReturnType<typeof vi.fn>;
  deleteComment: ReturnType<typeof vi.fn>;
  hideComment: ReturnType<typeof vi.fn>;
  likeComment: ReturnType<typeof vi.fn>;
  sendPrivateReply: ReturnType<typeof vi.fn>;

  // Engagement: Reviews
  listReviews: ReturnType<typeof vi.fn>;
  replyToReview: ReturnType<typeof vi.fn>;
  deleteReviewReply: ReturnType<typeof vi.fn>;

  // Media & Validation
  getPresignedUrl: ReturnType<typeof vi.fn>;
  validateMedia: ReturnType<typeof vi.fn>;
  validatePost: ReturnType<typeof vi.fn>;
  validatePostLength: ReturnType<typeof vi.fn>;
  checkInstagramHashtags: ReturnType<typeof vi.fn>;

  // Webhooks
  listWebhooks: ReturnType<typeof vi.fn>;
  createWebhook: ReturnType<typeof vi.fn>;
  updateWebhook: ReturnType<typeof vi.fn>;
  testWebhook: ReturnType<typeof vi.fn>;

  // Logs
  getPostLogs: ReturnType<typeof vi.fn>;
  listPublishingLogs: ReturnType<typeof vi.fn>;
  listConnectionLogs: ReturnType<typeof vi.fn>;
}

/**
 * Create a fully-mocked LateApiClient.
 * All methods are vi.fn() stubs that resolve to empty arrays/objects by default.
 */
export function createMockClient(): MockLateApiClient {
  return {
    // Profiles & Accounts
    listProfiles: vi.fn().mockResolvedValue({ data: [] }),
    listAccounts: vi.fn().mockResolvedValue({ data: [] }),
    getAccountHealth: vi.fn().mockResolvedValue({}),
    getAllAccountsHealth: vi.fn().mockResolvedValue([]),
    getUsageStats: vi.fn().mockResolvedValue({}),

    // Posts
    listPosts: vi.fn().mockResolvedValue({ data: [] }),
    getPost: vi.fn().mockResolvedValue({}),
    createPost: vi.fn().mockResolvedValue({}),
    updatePost: vi.fn().mockResolvedValue({}),
    deletePost: vi.fn().mockResolvedValue(undefined),
    retryPost: vi.fn().mockResolvedValue({}),
    unpublishPost: vi.fn().mockResolvedValue(undefined),

    // Analytics
    getAnalytics: vi.fn().mockResolvedValue({ data: [] }),
    getDailyMetrics: vi.fn().mockResolvedValue({ data: [] }),
    getFollowerStats: vi.fn().mockResolvedValue({ data: [] }),
    getPostTimeline: vi.fn().mockResolvedValue({ data: [] }),
    getYouTubeDailyViews: vi.fn().mockResolvedValue({ data: [] }),

    // Queue
    listQueues: vi.fn().mockResolvedValue([]),
    createQueue: vi.fn().mockResolvedValue(undefined),
    updateQueue: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue(undefined),
    previewQueueSlots: vi.fn().mockResolvedValue([]),

    // Engagement: Messages
    listConversations: vi.fn().mockResolvedValue({ data: [] }),
    getConversation: vi.fn().mockResolvedValue({}),
    listMessages: vi.fn().mockResolvedValue({ data: [] }),
    sendMessage: vi.fn().mockResolvedValue({}),
    editMessage: vi.fn().mockResolvedValue(undefined),

    // Engagement: Comments
    listCommentedPosts: vi.fn().mockResolvedValue({ data: [] }),
    getPostComments: vi.fn().mockResolvedValue({ data: [] }),
    replyToComment: vi.fn().mockResolvedValue({}),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    hideComment: vi.fn().mockResolvedValue(undefined),
    likeComment: vi.fn().mockResolvedValue(undefined),
    sendPrivateReply: vi.fn().mockResolvedValue({}),

    // Engagement: Reviews
    listReviews: vi.fn().mockResolvedValue({ data: [] }),
    replyToReview: vi.fn().mockResolvedValue({}),
    deleteReviewReply: vi.fn().mockResolvedValue(undefined),

    // Media & Validation
    getPresignedUrl: vi.fn().mockResolvedValue({}),
    validateMedia: vi.fn().mockResolvedValue({}),
    validatePost: vi.fn().mockResolvedValue({}),
    validatePostLength: vi.fn().mockResolvedValue({}),
    checkInstagramHashtags: vi.fn().mockResolvedValue({}),

    // Webhooks
    listWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({}),
    updateWebhook: vi.fn().mockResolvedValue({}),
    testWebhook: vi.fn().mockResolvedValue({}),

    // Logs
    getPostLogs: vi.fn().mockResolvedValue({ data: [] }),
    listPublishingLogs: vi.fn().mockResolvedValue({ data: [] }),
    listConnectionLogs: vi.fn().mockResolvedValue({ data: [] }),
  };
}

/**
 * Standard vi.mock blocks for the client module.
 * Returns the mock client for customization in individual tests.
 *
 * Usage in test files:
 * ```
 * import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';
 *
 * let mockClient: MockLateApiClient;
 *
 * vi.mock('../../src/client/lateClient.js', () => ({
 *   getClient: vi.fn(() => mockClient),
 *   toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
 *   toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
 *   resetClient: vi.fn(),
 *   LateApiClient: vi.fn(),
 * }));
 *
 * beforeEach(() => {
 *   mockClient = createMockClient();
 * });
 * ```
 */
