export type PostStatus =
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'publishing'
  | 'partial';

export type Platform =
  | 'twitter'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'reddit'
  | 'bluesky'
  | 'threads'
  | 'telegram'
  | 'snapchat'
  | 'google-business';

export interface LatePost {
  id: string;
  content: string;
  platforms: Platform[];
  scheduledFor: string | null;
  status: PostStatus;
  mediaItems: MediaItem[];
  platformPostUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video' | 'gif';
  altText?: string;
}

export interface LateAccount {
  id: string;
  platform: Platform;
  displayName: string;
  username: string;
  isActive: boolean;
  profileId: string;
}

export interface LateProfile {
  id: string;
  name: string;
  color: string;
  description: string;
}

export interface ListPostsOptions {
  status?: PostStatus;
  platform?: Platform;
  profileId?: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

export interface CreatePostParams {
  content: string;
  platforms: Platform[];
  scheduledFor?: string;
  profileId?: string;
  mediaUrls?: string[];
}

export interface UpdatePostParams {
  id: string;
  content?: string;
  platforms?: Platform[];
  scheduledFor?: string | null;
  status?: PostStatus;
}

export interface PriorityRule {
  platform: Platform;
  clipType?: string;
  weight: number;
  reason: string;
}

export interface RealignPlan {
  postsToMove: Array<{
    postId: string;
    currentTime: string;
    proposedTime: string;
    reason: string;
  }>;
  conflicts: Array<{
    postId: string;
    issue: string;
  }>;
  priorityRules: PriorityRule[];
}

export interface RealignResult {
  moved: number;
  skipped: number;
  errors: Array<{
    postId: string;
    error: string;
  }>;
  plan: RealignPlan;
}

export interface AnalyticsBestTime {
  platform: Platform;
  dayOfWeek: string;
  hour: number;
  engagementScore: number;
}

export interface PostingFrequency {
  platform: Platform;
  postsPerWeek: number;
  recommendedPerWeek: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface ContentDecay {
  postId: string;
  platform: Platform;
  publishedAt: string;
  peakEngagementHours: number;
  currentEngagementRate: number;
  decayRate: number;
}
