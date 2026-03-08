export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TimeSlot {
  days: DayOfWeek[];
  time: string; // "HH:MM" (24h)
  label: string;
}

export interface ClipTypeSchedule {
  slots: TimeSlot[];
  avoidDays: DayOfWeek[];
}

export interface PlatformSchedule {
  slots: TimeSlot[];
  avoidDays: DayOfWeek[];
  byClipType?: Record<string, ClipTypeSchedule>;
}

export interface ScheduleConfig {
  timezone: string;
  platforms: Record<string, PlatformSchedule>;
}
