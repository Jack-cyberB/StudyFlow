export type ViewKey = 'today' | 'weekly' | 'overrides' | 'stats' | 'settings';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ReminderMode = 'inherit' | 'off' | 'before' | 'start' | 'end' | 'combo';

export type StatsDisplayMode = 'hidden' | 'planned' | 'actual' | 'both';

export type SessionStatus = 'running' | 'completed' | 'skipped';

export type OccurrenceStatus = 'pending' | 'running' | 'completed' | 'skipped';

export interface ReminderPolicy {
  mode: ReminderMode;
  beforeMinutes: number[];
  notifyAtStart: boolean;
  notifyAtEnd: boolean;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  subject: string;
  startTime: string;
  endTime: string;
  color: string;
  reminderPolicy: ReminderPolicy;
  notes: string;
  enabled: boolean;
}

export interface WeeklyTemplate {
  weekday: Weekday;
  events: ScheduleEvent[];
}

export interface DateOverride {
  date: string;
  addedEvents: ScheduleEvent[];
  updatedEvents: ScheduleEvent[];
  removedEventIds: string[];
}

export interface StudySession {
  id: string;
  eventId: string;
  date: string;
  actualStart: string;
  actualEnd: string | null;
  durationMinutes: number;
  status: SessionStatus;
}

export interface AppSettings {
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  defaultReminderPolicy: ReminderPolicy;
  statsDisplayMode: StatsDisplayMode;
}

export interface PersistedState {
  schemaVersion: number;
  templates: WeeklyTemplate[];
  overrides: DateOverride[];
  sessions: StudySession[];
  settings: AppSettings;
}

export interface ScheduleOccurrence extends ScheduleEvent {
  date: string;
  source: 'template' | 'override-added' | 'override-updated';
  plannedMinutes: number;
  effectiveReminder: ReminderPolicy;
  status: OccurrenceStatus;
  latestSession?: StudySession;
  actualMinutes: number;
  conflict: boolean;
}

export interface SummaryMetrics {
  plannedMinutes: number;
  actualMinutes: number;
  remainingMinutes: number;
  completedCount: number;
  totalCount: number;
  nextEvent: ScheduleOccurrence | null;
}

export interface StatsSeriesPoint {
  date: string;
  label: string;
  plannedMinutes: number;
  actualMinutes: number;
}

export interface StatsExportRow {
  date: string;
  title: string;
  subject: string;
  startTime: string;
  endTime: string;
  plannedMinutes: number;
  actualMinutes: number;
  status: OccurrenceStatus;
}

export interface NotificationPlanItem {
  id: number;
  title: string;
  body: string;
  when: Date;
}
