// Late API response types — derived from actual API response shapes

// ─── Profiles & Accounts ────────────────────────────────────────────────────

export interface LateProfile {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  color?: string;
  accountUsernames?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LateAccount {
  _id: string;
  platform: string;
  displayName: string;
  username: string;
  isActive: boolean;
  profileId: { _id: string; name: string } | string;
  analyticsLastSyncedAt?: string | null;
  analyticsLastSyncError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LateAccountHealth {
  _id?: string;
  accountId?: string;
  platform?: string;
  displayName?: string;
  tokenStatus: string;
  permissions?: string[];
  recommendations?: string[];
}

export interface LateUsage {
  planName?: string;
  plan?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  limits?: Record<string, number>;
  usage?: Record<string, number>;
  [key: string]: unknown;
}

// ─── Posts ───────────────────────────────────────────────────────────────────

export interface LatePostPlatform {
  platform: string;
  accountId: string;
  status?: string;
  publishedUrl?: string;
}

export interface LateMediaItem {
  type: string;
  url: string;
  altText?: string;
  thumbnail?: { url: string };
}

export interface LatePost {
  _id: string;
  content: string;
  status: string;
  platforms: LatePostPlatform[];
  scheduledFor?: string;
  isDraft?: boolean;
  mediaItems?: LateMediaItem[];
  platformPostUrl?: string;
  createdAt: string;
  updatedAt: string;
  userId?: { _id: string; name: string; email: string } | string;
  title?: string;
}

export interface PlatformEntry {
  platform: string;
  accountId: string;
  profileId: string;
}

export interface CreatePostBody {
  content: string;
  platforms: PlatformEntry[];
  scheduledFor?: string;
  publishNow?: boolean;
  isDraft?: boolean;
  mediaUrls?: string[];
  mediaItems?: LateMediaItem[];
  timezone?: string;
  platformSpecificData?: Record<string, unknown>;
}

export interface UpdatePostBody {
  content?: string;
  scheduledFor?: string;
  status?: string;
  isDraft?: boolean;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface LateAnalyticsEntry {
  postId?: string;
  platform?: string;
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  engagementRate?: number;
  date?: string;
}

export interface LateDailyMetric {
  date: string;
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface LateFollowerStat {
  accountId?: string;
  platform?: string;
  date?: string;
  followers?: number;
  following?: number;
  gained?: number;
  lost?: number;
  netChange?: number;
}

export interface LateTimelineEntry {
  date?: string;
  timestamp?: string;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface LateYouTubeView {
  date: string;
  views?: number;
  count?: number;
}

// ─── Queue ──────────────────────────────────────────────────────────────────

export interface LateQueue {
  _id?: string;
  id?: string;
  name?: string;
  isDefault?: boolean;
  days?: string[];
  times?: string[];
}

export interface CreateQueueBody {
  profileId: string;
  name?: string;
  days: string[];
  times: string[];
  setAsDefault?: boolean;
}

export interface UpdateQueueBody {
  profileId: string;
  queueId?: string;
  name?: string;
  days?: string[];
  times?: string[];
  setAsDefault?: boolean;
}

export interface LateQueueSlot {
  datetime?: string;
  scheduledFor?: string;
  time?: string;
}

// ─── Engagement: Messages ───────────────────────────────────────────────────

export interface LateConversation {
  _id?: string;
  id?: string;
  platform?: string;
  participantName?: string;
  participant?: string;
  participantUsername?: string;
  accountId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  updatedAt?: string;
  unreadCount?: number;
  createdAt?: string;
}

export interface LateMessage {
  _id?: string;
  id?: string;
  senderName?: string;
  sender?: string;
  from?: string;
  sentAt?: string;
  createdAt?: string;
  timestamp?: string;
  isOutgoing?: boolean;
  message?: string;
  text?: string;
  content?: string;
}

export interface LateSendResult {
  id?: string;
  _id?: string;
  sentAt?: string;
}

// ─── Engagement: Comments ───────────────────────────────────────────────────

export interface LateCommentedPost {
  _id?: string;
  postId?: string;
  id?: string;
  platform?: string;
  content?: string;
  caption?: string;
  commentCount?: number;
  latestComment?: string;
  publishedAt?: string;
  createdAt?: string;
}

export interface LateComment {
  _id?: string;
  id?: string;
  commentId?: string;
  authorName?: string;
  author?: string;
  username?: string;
  createdAt?: string;
  timestamp?: string;
  message?: string;
  text?: string;
  comment?: string;
  likes?: number;
  replyCount?: number;
}

// ─── Engagement: Reviews ────────────────────────────────────────────────────

export interface LateReview {
  _id?: string;
  id?: string;
  reviewId?: string;
  platform?: string;
  authorName?: string;
  author?: string;
  rating?: number;
  message?: string;
  text?: string;
  comment?: string;
  reply?: string;
  createdAt?: string;
  date?: string;
}

// ─── Media & Validation ────────────────────────────────────────────────────

export interface LatePresignResult {
  uploadUrl: string;
  publicUrl: string;
  key?: string;
  expiresIn?: number;
}

export interface LateValidationIssue {
  platform?: string;
  message: string;
}

export interface LateValidationResult {
  errors?: LateValidationIssue[];
  warnings?: LateValidationIssue[];
}

export interface LatePlatformLength {
  platform: string;
  withinLimit: boolean;
  length: number;
  maxLength: number;
}

export interface LatePostLengthResult {
  platforms?: LatePlatformLength[];
  [key: string]: unknown;
}

export interface LateHashtagEntry {
  hashtag?: string;
  name?: string;
  status: string;
}

export interface LateHashtagResult {
  hashtags?: LateHashtagEntry[];
  results?: LateHashtagEntry[];
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

export interface LateWebhook {
  _id?: string;
  id?: string;
  name?: string;
  url: string;
  events: string[];
  isActive?: boolean;
}

export interface LateWebhookTestResult {
  success?: boolean;
  statusCode?: number;
  message?: string;
  error?: string;
}

// ─── Logs ───────────────────────────────────────────────────────────────────

export interface LateLog {
  platform?: string;
  timestamp?: string;
  createdAt?: string;
  status?: string;
  action?: string;
  message?: string;
  details?: string;
  error?: string;
  postId?: string;
  accountId?: string;
}

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination?: PaginationMeta;
}

// ─── API Response Wrappers (raw shapes from the Late API) ───────────────────

export interface ListProfilesResponse {
  profiles: LateProfile[];
}

export interface ListAccountsResponse {
  accounts: LateAccount[];
  hasAnalyticsAccess?: boolean;
}

export interface ListPostsResponse {
  posts: LatePost[];
  pagination?: { page?: number; limit?: number; total?: number; totalPages?: number };
}

export interface SinglePostResponse {
  post: LatePost;
}
