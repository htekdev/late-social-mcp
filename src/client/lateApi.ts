import { getLateApiKey } from '../config/config.js';
import type {
  LateProfile, LateAccount, LateAccountHealth, LateUsage,
  LatePost, CreatePostBody, UpdatePostBody, PlatformEntry,
  LateAnalyticsEntry, LateDailyMetric, LateFollowerStat, LateTimelineEntry, LateYouTubeView,
  LateQueue, CreateQueueBody, UpdateQueueBody, LateQueueSlot,
  LateConversation, LateMessage, LateSendResult,
  LateCommentedPost, LateComment,
  LateReview,
  LatePresignResult, LateValidationResult, LatePostLengthResult, LateHashtagResult,
  LateWebhook, LateWebhookTestResult,
  LateLog,
  PaginationMeta, PaginatedResult,
} from '../types/api.js';

const BASE_URL = 'https://getlate.dev/api/v1';
const MAX_RETRIES = 3;

export class LateApiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ─── Core HTTP ──────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | number | boolean | undefined> },
  ): Promise<T> {
    let url = `${BASE_URL}${path}`;
    if (opts?.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
      });

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (res.status === 204 || res.status === 202) {
        return undefined as T;
      }

      const data = await res.json().catch(() => null) as Record<string, unknown> | null;

      if (!res.ok) {
        const msg = data?.error ?? data?.message ?? `HTTP ${res.status}`;
        throw new Error(`Late API error: ${msg}`);
      }

      return data as T;
    }

    throw lastError ?? new Error('Late API error: max retries exceeded');
  }

  /** Extract an array and optional pagination metadata from a wrapped response */
  private extractPaginated<T>(data: unknown): PaginatedResult<T> {
    if (Array.isArray(data)) return { data };
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      let items: T[] = [];
      let pagination: PaginationMeta | undefined;

      for (const [key, val] of Object.entries(obj)) {
        if (Array.isArray(val) && items.length === 0) {
          items = val as T[];
        }
        if (key === 'pagination' && val && typeof val === 'object') {
          pagination = val as PaginationMeta;
        }
      }

      return { data: items, pagination };
    }
    return { data: [] };
  }

  // ─── Profiles & Accounts ──────────────────────────────────────────────────

  async listProfiles(opts?: { limit?: number; page?: number }): Promise<PaginatedResult<LateProfile>> {
    const data = await this.request<unknown>('GET', '/profiles', { query: opts as Record<string, number | undefined> });
    return this.extractPaginated<LateProfile>(data);
  }

  async listAccounts(opts?: { platform?: string; profileId?: string; limit?: number; page?: number }): Promise<PaginatedResult<LateAccount>> {
    const data = await this.request<unknown>('GET', '/accounts', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateAccount>(data);
  }

  async getAccountHealth(accountId: string): Promise<LateAccountHealth> {
    return this.request<LateAccountHealth>('GET', `/accounts/${accountId}/health`);
  }

  async getAllAccountsHealth(): Promise<LateAccountHealth[]> {
    const result = await this.request<unknown>('GET', '/accounts/health');
    return this.extractPaginated<LateAccountHealth>(result).data;
  }

  async getUsageStats(): Promise<LateUsage> {
    return this.request<LateUsage>('GET', '/usage');
  }

  async resolvePlatforms(platformNames: string[]): Promise<PlatformEntry[]> {
    const accounts = await this.listAccounts();
    const resolved: PlatformEntry[] = [];

    for (const name of platformNames) {
      const normalized = name.toLowerCase();
      const account = accounts.find(
        (a) => a.platform.toLowerCase() === normalized && a.isActive,
      );

      if (!account) {
        const available = accounts
          .filter((a) => a.isActive)
          .map((a) => a.platform)
          .join(', ');
        throw new Error(
          `No active account found for platform "${name}". Available: ${available || 'none'}`,
        );
      }

      const profileId = typeof account.profileId === 'string'
        ? account.profileId
        : account.profileId._id;

      resolved.push({
        platform: account.platform,
        accountId: account._id,
        profileId,
      });
    }

    return resolved;
  }

  // ─── Posts ────────────────────────────────────────────────────────────────

  async listPosts(opts?: {
    status?: string; platform?: string; search?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LatePost>> {
    const data = await this.request<unknown>('GET', '/posts', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LatePost>(data);
  }

  async getPost(postId: string): Promise<LatePost> {
    const data = await this.request<unknown>('GET', `/posts/${postId}`);
    if (data && typeof data === 'object' && 'post' in data) {
      return (data as Record<string, unknown>).post as LatePost;
    }
    return data as LatePost;
  }

  async createPost(body: CreatePostBody): Promise<LatePost> {
    const data = await this.request<unknown>('POST', '/posts', { body });
    if (data && typeof data === 'object' && 'post' in data) {
      return (data as Record<string, unknown>).post as LatePost;
    }
    return data as LatePost;
  }

  async updatePost(postId: string, body: UpdatePostBody): Promise<LatePost> {
    const data = await this.request<unknown>('PUT', `/posts/${postId}`, { body });
    if (data && typeof data === 'object' && 'post' in data) {
      return (data as Record<string, unknown>).post as LatePost;
    }
    return data as LatePost;
  }

  async deletePost(postId: string): Promise<void> {
    await this.request<void>('DELETE', `/posts/${postId}`);
  }

  async retryPost(postId: string): Promise<LatePost> {
    const data = await this.request<unknown>('POST', `/posts/${postId}/retry`);
    if (data && typeof data === 'object' && 'post' in data) {
      return (data as Record<string, unknown>).post as LatePost;
    }
    return data as LatePost;
  }

  async unpublishPost(postId: string, platforms: string[]): Promise<void> {
    await this.request<void>('POST', `/posts/${postId}/unpublish`, { body: { platforms } });
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  async getAnalytics(opts?: {
    postId?: string; fromDate?: string; toDate?: string; platform?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateAnalyticsEntry>> {
    const data = await this.request<unknown>('GET', '/analytics', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateAnalyticsEntry>(data);
  }

  async getDailyMetrics(opts?: {
    dateFrom?: string; dateTo?: string; platforms?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateDailyMetric>> {
    const data = await this.request<unknown>('GET', '/analytics/daily', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateDailyMetric>(data);
  }

  async getFollowerStats(opts?: {
    dateFrom?: string; dateTo?: string; accountId?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateFollowerStat>> {
    const data = await this.request<unknown>('GET', '/accounts/followers', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateFollowerStat>(data);
  }

  async getPostTimeline(postId: string, opts?: {
    dateFrom?: string; dateTo?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateTimelineEntry>> {
    const query = { postId, ...opts } as Record<string, string | number | undefined>;
    const data = await this.request<unknown>('GET', '/analytics/post-timeline', { query });
    return this.extractPaginated<LateTimelineEntry>(data);
  }

  async getYouTubeDailyViews(videoId: string, opts?: {
    dateFrom?: string; dateTo?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateYouTubeView>> {
    const query = { videoId, ...opts } as Record<string, string | number | undefined>;
    const data = await this.request<unknown>('GET', '/analytics/youtube-daily-views', { query });
    return this.extractPaginated<LateYouTubeView>(data);
  }

  // ─── Queue ────────────────────────────────────────────────────────────────

  async listQueues(profileId: string): Promise<LateQueue[]> {
    const result = await this.request<unknown>('GET', '/queue', { query: { profileId, all: true } });
    return this.extractPaginated<LateQueue>(result).data;
  }

  async createQueue(body: CreateQueueBody): Promise<void> {
    await this.request<void>('POST', '/queue', { body });
  }

  async updateQueue(body: UpdateQueueBody): Promise<void> {
    await this.request<void>('PUT', '/queue', { body });
  }

  async deleteQueue(profileId: string, queueId: string): Promise<void> {
    await this.request<void>('DELETE', '/queue', { query: { profileId, queueId } });
  }

  async previewQueueSlots(profileId: string, opts?: {
    count?: number; queueId?: string;
  }): Promise<LateQueueSlot[]> {
    const query = { profileId, ...opts } as Record<string, string | number | undefined>;
    const result = await this.request<unknown>('GET', '/queue/preview', { query });
    return this.extractPaginated<LateQueueSlot>(result).data;
  }

  // ─── Engagement: Messages ─────────────────────────────────────────────────

  async listConversations(opts?: {
    profileId?: string; platform?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateConversation>> {
    const data = await this.request<unknown>('GET', '/inbox/conversations', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateConversation>(data);
  }

  async getConversation(conversationId: string, accountId: string): Promise<LateConversation> {
    return this.request<LateConversation>('GET', `/inbox/conversations/${conversationId}`, {
      query: { accountId },
    });
  }

  async listMessages(conversationId: string, accountId: string, opts?: {
    limit?: number; page?: number;
  }): Promise<PaginatedResult<LateMessage>> {
    const query = { accountId, ...opts } as Record<string, string | number | undefined>;
    const data = await this.request<unknown>('GET', `/inbox/conversations/${conversationId}/messages`, { query });
    return this.extractPaginated<LateMessage>(data);
  }

  async sendMessage(conversationId: string, accountId: string, message: string): Promise<LateSendResult> {
    return this.request<LateSendResult>('POST', `/inbox/conversations/${conversationId}/messages`, {
      body: { accountId, message },
    });
  }

  async editMessage(conversationId: string, messageId: string, message: string): Promise<void> {
    await this.request<void>('PUT', `/inbox/conversations/${conversationId}/messages/${messageId}`, {
      body: { message },
    });
  }

  // ─── Engagement: Comments ─────────────────────────────────────────────────

  async listCommentedPosts(opts?: {
    profileId?: string; platform?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateCommentedPost>> {
    const data = await this.request<unknown>('GET', '/inbox/comments', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateCommentedPost>(data);
  }

  async getPostComments(postId: string, opts?: {
    accountId?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateComment>> {
    const data = await this.request<unknown>('GET', `/inbox/comments/${postId}`, { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateComment>(data);
  }

  async replyToComment(postId: string, accountId: string, commentId: string, message: string): Promise<LateSendResult> {
    return this.request<LateSendResult>('POST', `/inbox/comments/${postId}/reply`, {
      body: { accountId, commentId, message },
    });
  }

  async deleteComment(commentId: string, accountId: string): Promise<void> {
    await this.request<void>('DELETE', `/inbox/comments/${commentId}`, { body: { accountId } });
  }

  async hideComment(commentId: string, accountId: string): Promise<void> {
    await this.request<void>('POST', `/inbox/comments/${commentId}/hide`, { body: { accountId } });
  }

  async likeComment(commentId: string, accountId: string): Promise<void> {
    await this.request<void>('POST', `/inbox/comments/${commentId}/like`, { body: { accountId } });
  }

  async sendPrivateReply(commentId: string, accountId: string, message: string): Promise<LateSendResult> {
    return this.request<LateSendResult>('POST', `/inbox/comments/${commentId}/private-reply`, {
      body: { accountId, message },
    });
  }

  // ─── Engagement: Reviews ──────────────────────────────────────────────────

  async listReviews(opts?: {
    accountId?: string; platform?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateReview>> {
    const data = await this.request<unknown>('GET', '/inbox/reviews', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateReview>(data);
  }

  async replyToReview(reviewId: string, accountId: string, message: string): Promise<LateSendResult> {
    return this.request<LateSendResult>('POST', `/inbox/reviews/${reviewId}/reply`, {
      body: { accountId, message },
    });
  }

  async deleteReviewReply(reviewReplyId: string, accountId: string): Promise<void> {
    await this.request<void>('DELETE', `/inbox/reviews/${reviewReplyId}`, { body: { accountId } });
  }

  // ─── Media & Validation ───────────────────────────────────────────────────

  async getPresignedUrl(filename: string, mimeType: string): Promise<LatePresignResult> {
    return this.request<LatePresignResult>('POST', '/media/presign', {
      body: { filename, mimeType },
    });
  }

  async validateMedia(mediaUrl: string, platforms: string[]): Promise<LateValidationResult> {
    return this.request<LateValidationResult>('POST', '/validate/media', {
      body: { platforms, mediaItems: [{ url: mediaUrl }] },
    });
  }

  async validatePost(content: string, platforms: string[], mediaUrls?: string[]): Promise<LateValidationResult> {
    const body: Record<string, unknown> = { content, platforms };
    if (mediaUrls?.length) {
      body.mediaItems = mediaUrls.map(url => ({ url }));
    }
    return this.request<LateValidationResult>('POST', '/validate/post', { body });
  }

  async validatePostLength(content: string, platforms: string[]): Promise<LatePostLengthResult> {
    return this.request<LatePostLengthResult>('POST', '/validate/post-length', {
      body: { content, platforms },
    });
  }

  async checkInstagramHashtags(hashtags: string[]): Promise<LateHashtagResult> {
    return this.request<LateHashtagResult>('POST', '/tools/instagram-hashtags', {
      body: { hashtags },
    });
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  async listWebhooks(): Promise<LateWebhook[]> {
    const result = await this.request<unknown>('GET', '/webhooks');
    return this.extractPaginated<LateWebhook>(result).data;
  }

  async createWebhook(url: string, events: string[], name?: string): Promise<LateWebhook> {
    return this.request<LateWebhook>('POST', '/webhooks', {
      body: { url, events, ...(name ? { name } : {}) },
    });
  }

  async updateWebhook(webhookId: string, opts: {
    url?: string; events?: string[]; name?: string; isActive?: boolean;
  }): Promise<LateWebhook> {
    return this.request<LateWebhook>('PUT', '/webhooks', {
      body: { _id: webhookId, ...opts },
    });
  }

  async testWebhook(webhookId: string): Promise<LateWebhookTestResult> {
    return this.request<LateWebhookTestResult>('POST', '/webhooks/test', {
      body: { webhookId },
    });
  }

  // ─── Logs ─────────────────────────────────────────────────────────────────

  async getPostLogs(postId: string, opts?: {
    limit?: number; page?: number;
  }): Promise<PaginatedResult<LateLog>> {
    const data = await this.request<unknown>('GET', `/logs/posts/${postId}`, { query: opts as Record<string, number | undefined> });
    return this.extractPaginated<LateLog>(data);
  }

  async listPublishingLogs(opts?: {
    status?: string; platform?: string; action?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateLog>> {
    const data = await this.request<unknown>('GET', '/logs/publishing', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateLog>(data);
  }

  async listConnectionLogs(opts?: {
    platform?: string; status?: string; limit?: number; page?: number;
  }): Promise<PaginatedResult<LateLog>> {
    const data = await this.request<unknown>('GET', '/logs/connections', { query: opts as Record<string, string | number | undefined> });
    return this.extractPaginated<LateLog>(data);
  }
}

// ─── Singleton & Helpers ──────────────────────────────────────────────────────

let clientInstance: LateApiClient | null = null;

export function getClient(): LateApiClient {
  if (clientInstance) return clientInstance;
  const apiKey = getLateApiKey();
  if (!apiKey) {
    throw new Error('Late API key not configured. Set LATE_API_KEY environment variable.');
  }
  clientInstance = new LateApiClient(apiKey);
  return clientInstance;
}

export function resetClient(): void {
  clientInstance = null;
}

// Normalize platform names for Late API (API uses 'twitter', schedule config uses 'x')
const API_PLATFORM_MAP: Record<string, string> = { x: 'twitter' };
const DISPLAY_PLATFORM_MAP: Record<string, string> = { twitter: 'x' };

export function toApiPlatform(platform: string): string {
  return API_PLATFORM_MAP[platform.toLowerCase()] ?? platform.toLowerCase();
}

export function toDisplayPlatform(platform: string): string {
  return DISPLAY_PLATFORM_MAP[platform.toLowerCase()] ?? platform.toLowerCase();
}
