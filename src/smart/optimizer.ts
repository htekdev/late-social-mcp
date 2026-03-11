import { getClient } from '../client/lateClient.js';

export interface BestTimeResult {
  platform: string;
  bestTimes: Array<{
    day: string;
    hour: number;
    engagement: number;
  }>;
}

export async function getBestTimesToPost(platform?: string): Promise<BestTimeResult[]> {
  const client = getClient();

  try {
    const { data: results } = await client.getAnalytics(platform ? { platform } : {});

    return results.map((item: unknown) => {
      const r = item as Record<string, unknown>;
      const times = (r.bestTimes ?? r.times ?? r.data ?? []) as unknown[];
      return {
        platform: (r.platform ?? platform ?? 'all') as string,
        bestTimes: times.map((t: unknown) => {
          const time = t as Record<string, unknown>;
          return {
            day: (time.day ?? time.dayOfWeek ?? '') as string,
            hour: (time.hour ?? time.time ?? 0) as number,
            engagement: (time.engagement ?? time.score ?? time.value ?? 0) as number,
          };
        }),
      };
    });
  } catch {
    return [];
  }
}

export interface PostingFrequencyResult {
  platform: string;
  currentFrequency: number;
  optimalFrequency: number;
  engagementCorrelation: number;
  recommendation: string;
}

export async function getPostingFrequency(platform?: string): Promise<PostingFrequencyResult[]> {
  const client = getClient();

  try {
    const { data: results } = await client.getAnalytics(platform ? { platform } : {});

    return results.map((item: unknown) => {
      const r = item as Record<string, unknown>;
      const current = (r.currentFrequency ?? r.current ?? 0) as number;
      const optimal = (r.optimalFrequency ?? r.optimal ?? r.recommended ?? 0) as number;
      const correlation = (r.engagementCorrelation ?? r.correlation ?? 0) as number;

      let recommendation = 'Maintain current posting frequency';
      if (optimal > current * 1.2) {
        recommendation = `Consider increasing from ${current} to ${optimal} posts/week`;
      } else if (optimal < current * 0.8) {
        recommendation = `Consider reducing from ${current} to ${optimal} posts/week`;
      }

      return {
        platform: (r.platform ?? platform ?? 'all') as string,
        currentFrequency: current,
        optimalFrequency: optimal,
        engagementCorrelation: correlation,
        recommendation,
      };
    });
  } catch {
    return [];
  }
}

export interface ContentDecayResult {
  postId: string;
  platform: string;
  publishedAt: string;
  totalEngagement: number;
  decayPoints: Array<{
    hoursAfterPublish: number;
    cumulativeEngagement: number;
    percentOfTotal: number;
  }>;
  halfLifeHours: number | null;
}

export async function getContentDecay(
  postId?: string,
  platform?: string,
): Promise<ContentDecayResult[]> {
  const client = getClient();

  try {
    if (postId) {
      const { data: timeline } = await client.getPostTimeline(postId, {});

      const publishedAt = '';
      const publishedMs = Date.now();

      let total = 0;
      const decayPoints: ContentDecayResult['decayPoints'] = [];

      for (const point of timeline) {
        const p = point as Record<string, unknown>;
        const engagement = ((p.likes ?? 0) as number) + ((p.comments ?? 0) as number)
          + ((p.shares ?? 0) as number) + ((p.impressions ?? 0) as number);
        total += engagement;
        const pointDate = new Date((p.date ?? p.timestamp ?? '') as string);
        const hoursAfter = Math.round((pointDate.getTime() - publishedMs) / (1000 * 60 * 60));

        decayPoints.push({
          hoursAfterPublish: hoursAfter,
          cumulativeEngagement: total,
          percentOfTotal: 0,
        });
      }

      for (const dp of decayPoints) {
        dp.percentOfTotal = total > 0 ? Math.round((dp.cumulativeEngagement / total) * 100) : 0;
      }

      let halfLifeHours: number | null = null;
      if (total > 0) {
        const halfTarget = total / 2;
        const halfPoint = decayPoints.find(dp => dp.cumulativeEngagement >= halfTarget);
        if (halfPoint) halfLifeHours = halfPoint.hoursAfterPublish;
      }

      return [{
        postId: postId,
        platform: platform ?? 'unknown',
        publishedAt,
        totalEngagement: total,
        decayPoints,
        halfLifeHours,
      }];
    }

    const { data: posts } = await client.getAnalytics({
      platform: platform ?? undefined,
      limit: 20,
    });

    const results: ContentDecayResult[] = [];
    for (const p of posts.slice(0, 5)) {
      const post = p as Record<string, unknown>;
      const id = (post._id ?? post.postId ?? post.id) as string;
      if (!id) continue;

      try {
        const timelineResult = await getContentDecay(id, platform);
        results.push(...timelineResult);
        await new Promise(r => setTimeout(r, 200));
      } catch {
        continue;
      }
    }

    return results;
  } catch {
    return [];
  }
}
