import dayjs, { type Dayjs } from 'dayjs';

import type {
  AppSettings,
  DateOverride,
  NotificationPlanItem,
  OccurrenceStatus,
  PersistedState,
  ReminderPolicy,
  ScheduleEvent,
  ScheduleOccurrence,
  StatsExportRow,
  StatsSeriesPoint,
  StudySession,
  SummaryMetrics,
  Weekday,
  WeeklyTemplate,
} from '../types';

export const DATE_FORMAT = 'YYYY-MM-DD';
const STATS_DISPLAY_MODES = new Set(['hidden', 'planned', 'actual', 'both'] as const);
export const WEEKDAYS: Array<{ value: Weekday; label: string; short: string }> = [
  { value: 0, label: '星期日', short: '周日' },
  { value: 1, label: '星期一', short: '周一' },
  { value: 2, label: '星期二', short: '周二' },
  { value: 3, label: '星期三', short: '周三' },
  { value: 4, label: '星期四', short: '周四' },
  { value: 5, label: '星期五', short: '周五' },
  { value: 6, label: '星期六', short: '周六' },
];

export const COLOR_SWATCHES = [
  '#3f8d7d',
  '#7e9f4d',
  '#db8d56',
  '#bc6b5f',
  '#8d7bc2',
  '#5087b5',
];

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  mode: 'end',
  beforeMinutes: [10],
  notifyAtStart: false,
  notifyAtEnd: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  launchAtStartup: false,
  minimizeToTray: true,
  defaultReminderPolicy: DEFAULT_REMINDER_POLICY,
  statsDisplayMode: 'both',
};

const APP_SCHEMA_VERSION = 1;

const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `sf-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

const clampMinutes = (value: number) => Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));

const toMinutes = (time: string) => {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
};

export const minutesToTime = (totalMinutes: number) => {
  const safe = clampMinutes(totalMinutes);
  const hours = `${Math.floor(safe / 60)}`.padStart(2, '0');
  const minutes = `${safe % 60}`.padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const minutesBetween = (startTime: string, endTime: string) =>
  Math.max(0, toMinutes(endTime) - toMinutes(startTime));

export const formatMinutes = (value: number) => {
  const safe = Math.max(0, Math.round(value));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;

  if (!hours) {
    return `${minutes} 分钟`;
  }

  if (!minutes) {
    return `${hours} 小时`;
  }

  return `${hours} 小时 ${minutes} 分钟`;
};

const uniqueSortedMinutes = (values: number[]) =>
  [...new Set(values.map((value) => Math.max(1, Math.round(value))))].sort((left, right) => right - left);

export const normalizeReminderPolicy = (
  policy?: Partial<ReminderPolicy> | null,
  allowInherit = true,
): ReminderPolicy => {
  const defaultMode = allowInherit ? 'inherit' : 'end';
  const mode = (policy?.mode ?? defaultMode) as ReminderPolicy['mode'];
  const beforeMinutes = uniqueSortedMinutes(policy?.beforeMinutes ?? [10]);

  return {
    mode: allowInherit ? mode : mode === 'inherit' ? 'end' : mode,
    beforeMinutes,
    notifyAtStart: Boolean(policy?.notifyAtStart),
    notifyAtEnd: policy?.notifyAtEnd ?? mode === 'end',
  };
};

export const normalizeStatsDisplayMode = (value: unknown): AppSettings['statsDisplayMode'] =>
  typeof value === 'string' && STATS_DISPLAY_MODES.has(value as AppSettings['statsDisplayMode'])
    ? (value as AppSettings['statsDisplayMode'])
    : DEFAULT_SETTINGS.statsDisplayMode;

const normalizeEvent = (event?: Partial<ScheduleEvent> | null): ScheduleEvent => ({
  id: event?.id ?? createId(),
  title: event?.title?.trim() || '学习时段',
  subject: event?.subject?.trim() || '自习',
  startTime: event?.startTime ?? '19:00',
  endTime: event?.endTime ?? '20:00',
  color: event?.color ?? COLOR_SWATCHES[0],
  reminderPolicy: normalizeReminderPolicy(event?.reminderPolicy),
  notes: event?.notes?.trim() ?? '',
  enabled: event?.enabled ?? true,
});

const normalizeTemplate = (template: WeeklyTemplate): WeeklyTemplate => ({
  weekday: template.weekday,
  events: sortEvents((template.events ?? []).map((event) => normalizeEvent(event))),
});

const normalizeOverride = (override: DateOverride): DateOverride => ({
  date: override.date,
  addedEvents: sortEvents((override.addedEvents ?? []).map((event) => normalizeEvent(event))),
  updatedEvents: sortEvents((override.updatedEvents ?? []).map((event) => normalizeEvent(event))),
  removedEventIds: [...new Set(override.removedEventIds ?? [])],
});

const normalizeSession = (session: StudySession): StudySession => ({
  id: session.id ?? createId(),
  eventId: session.eventId,
  date: session.date,
  actualStart: session.actualStart,
  actualEnd: session.actualEnd ?? null,
  durationMinutes: Math.max(0, Math.round(session.durationMinutes ?? 0)),
  status: session.status ?? 'completed',
});

export const normalizeState = (raw?: Partial<PersistedState> | null): PersistedState => {
  const templateMap = new Map<Weekday, WeeklyTemplate>();
  const sourceTemplates = raw?.templates ?? [];

  sourceTemplates.forEach((template) => {
    templateMap.set(template.weekday, normalizeTemplate(template));
  });

  const templates = WEEKDAYS.map(({ value }) => templateMap.get(value) ?? { weekday: value, events: [] });
  const overrides = (raw?.overrides ?? []).map(normalizeOverride).sort((left, right) => left.date.localeCompare(right.date));
  const sessions = (raw?.sessions ?? [])
    .map(normalizeSession)
    .sort((left, right) => left.actualStart.localeCompare(right.actualStart));
  const settings: AppSettings = {
    launchAtStartup: raw?.settings?.launchAtStartup ?? DEFAULT_SETTINGS.launchAtStartup,
    minimizeToTray: raw?.settings?.minimizeToTray ?? DEFAULT_SETTINGS.minimizeToTray,
    defaultReminderPolicy: normalizeReminderPolicy(raw?.settings?.defaultReminderPolicy, false),
    statsDisplayMode: normalizeStatsDisplayMode(raw?.settings?.statsDisplayMode),
  };

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    templates,
    overrides,
    sessions,
    settings,
  };
};

export const EMPTY_STATE = normalizeState();

export const sortEvents = (events: ScheduleEvent[]) =>
  [...events].sort((left, right) => {
    const startDiff = toMinutes(left.startTime) - toMinutes(right.startTime);
    if (startDiff !== 0) {
      return startDiff;
    }

    const endDiff = toMinutes(left.endTime) - toMinutes(right.endTime);
    if (endDiff !== 0) {
      return endDiff;
    }

    return left.title.localeCompare(right.title, 'zh-Hans-CN');
  });

export const getWeekdayLabel = (weekday: Weekday) =>
  WEEKDAYS.find((item) => item.value === weekday)?.label ?? '未知';

export const getTemplateForWeekday = (state: PersistedState, weekday: Weekday) =>
  state.templates.find((template) => template.weekday === weekday) ?? { weekday, events: [] };

export const getOverrideForDate = (state: PersistedState, date: string) =>
  state.overrides.find((override) => override.date === date);

const sameReminderPolicy = (left: ReminderPolicy, right: ReminderPolicy) =>
  left.mode === right.mode &&
  left.notifyAtStart === right.notifyAtStart &&
  left.notifyAtEnd === right.notifyAtEnd &&
  JSON.stringify(uniqueSortedMinutes(left.beforeMinutes)) === JSON.stringify(uniqueSortedMinutes(right.beforeMinutes));

const sameEvent = (left: ScheduleEvent, right: ScheduleEvent) =>
  left.title === right.title &&
  left.subject === right.subject &&
  left.startTime === right.startTime &&
  left.endTime === right.endTime &&
  left.color === right.color &&
  left.notes === right.notes &&
  left.enabled === right.enabled &&
  sameReminderPolicy(left.reminderPolicy, right.reminderPolicy);

const getEffectiveReminder = (policy: ReminderPolicy, fallback: ReminderPolicy): ReminderPolicy =>
  policy.mode === 'inherit' ? fallback : normalizeReminderPolicy(policy, false);

const getSessionsForEventOnDate = (sessions: StudySession[], eventId: string, date: string) =>
  sessions
    .filter((session) => session.eventId === eventId && session.date === date)
    .sort((left, right) => left.actualStart.localeCompare(right.actualStart));

const getLatestSessionForEvent = (sessions: StudySession[], eventId: string, date: string) =>
  getSessionsForEventOnDate(sessions, eventId, date).at(-1);

const getSessionActualMinutes = (session: StudySession, now: Dayjs) => {
  if (session.status === 'running') {
    return Math.max(0, now.diff(dayjs(session.actualStart), 'minute'));
  }

  return session.durationMinutes;
};

const getActualMinutesForEvent = (sessions: StudySession[], eventId: string, date: string, now: Dayjs) =>
  getSessionsForEventOnDate(sessions, eventId, date).reduce(
    (total, session) => total + getSessionActualMinutes(session, now),
    0,
  );

const getOccurrenceStatus = (latestSession: StudySession | undefined): OccurrenceStatus => {
  if (!latestSession) {
    return 'pending';
  }

  if (latestSession.status === 'running') {
    return 'running';
  }

  if (latestSession.status === 'skipped') {
    return 'skipped';
  }

  return 'completed';
};

const findConflictIds = (events: ScheduleEvent[]) => {
  const conflicts = new Set<string>();

  events.forEach((event, index) => {
    const eventEnd = toMinutes(event.endTime);

    for (let cursor = index + 1; cursor < events.length; cursor += 1) {
      const compared = events[cursor];
      const comparedStart = toMinutes(compared.startTime);

      if (comparedStart >= eventEnd) {
        break;
      }

      conflicts.add(event.id);
      conflicts.add(compared.id);
    }
  });

  return conflicts;
};

export const stripOccurrence = (occurrence: ScheduleOccurrence): ScheduleEvent => ({
  id: occurrence.id,
  title: occurrence.title,
  subject: occurrence.subject,
  startTime: occurrence.startTime,
  endTime: occurrence.endTime,
  color: occurrence.color,
  reminderPolicy: occurrence.reminderPolicy,
  notes: occurrence.notes,
  enabled: occurrence.enabled,
});

export const deriveScheduleForDate = (
  state: PersistedState,
  date: string,
  now = dayjs(),
): ScheduleOccurrence[] => {
  const weekday = dayjs(date).day() as Weekday;
  const template = getTemplateForWeekday(state, weekday);
  const override = getOverrideForDate(state, date);

  let events = template.events.map((event) => normalizeEvent(event));

  if (override) {
    const removedIds = new Set(override.removedEventIds);
    const updatedMap = new Map(override.updatedEvents.map((event) => [event.id, normalizeEvent(event)]));

    events = events
      .filter((event) => !removedIds.has(event.id))
      .map((event) => updatedMap.get(event.id) ?? event)
      .concat(override.addedEvents.map((event) => normalizeEvent(event)));
  }

  const ordered = sortEvents(events);
  const conflicts = findConflictIds(ordered);

  return ordered.map((event) => {
    const latestSession = getLatestSessionForEvent(state.sessions, event.id, date);
    const source = override?.addedEvents.some((item) => item.id === event.id)
      ? 'override-added'
      : override?.updatedEvents.some((item) => item.id === event.id)
        ? 'override-updated'
        : 'template';
    const plannedMinutes = minutesBetween(event.startTime, event.endTime);

    return {
      ...event,
      date,
      source,
      plannedMinutes,
      effectiveReminder: getEffectiveReminder(event.reminderPolicy, state.settings.defaultReminderPolicy),
      status: getOccurrenceStatus(latestSession),
      latestSession,
      actualMinutes: getActualMinutesForEvent(state.sessions, event.id, date, now),
      conflict: conflicts.has(event.id),
    };
  });
};

export const suggestEventSlot = (events: ScheduleEvent[]) => {
  const lastEvent = sortEvents(events).at(-1);
  const startTime = lastEvent?.endTime ?? '19:00';
  const endTime = minutesToTime(toMinutes(startTime) + 60);

  return { startTime, endTime };
};

export const createEvent = (event?: Partial<ScheduleEvent>): ScheduleEvent => {
  const draft = normalizeEvent(event);
  const duration = Math.max(30, minutesBetween(draft.startTime, draft.endTime));

  return {
    ...draft,
    endTime: minutesToTime(toMinutes(draft.startTime) + duration),
  };
};

export const upsertTemplateEvent = (
  state: PersistedState,
  weekday: Weekday,
  event: ScheduleEvent,
) =>
  normalizeState({
    ...state,
    templates: state.templates.map((template) =>
      template.weekday !== weekday
        ? template
        : {
            ...template,
            events: sortEvents(
              template.events.some((item) => item.id === event.id)
                ? template.events.map((item) => (item.id === event.id ? normalizeEvent(event) : item))
                : [...template.events, normalizeEvent(event)],
            ),
          },
    ),
  });

export const removeTemplateEvent = (state: PersistedState, weekday: Weekday, eventId: string) =>
  normalizeState({
    ...state,
    templates: state.templates.map((template) =>
      template.weekday !== weekday
        ? template
        : {
            ...template,
            events: template.events.filter((event) => event.id !== eventId),
          },
    ),
  });

export const copyTemplateToWeekdays = (
  state: PersistedState,
  sourceWeekday: Weekday,
  targetWeekdays: Weekday[],
) => {
  const sourceEvents = getTemplateForWeekday(state, sourceWeekday).events;

  return normalizeState({
    ...state,
    templates: state.templates.map((template) =>
      !targetWeekdays.includes(template.weekday)
        ? template
        : {
            ...template,
            events: sourceEvents.map((event) =>
              normalizeEvent({
                ...event,
                id: createId(),
              }),
            ),
          },
    ),
  });
};

export const applyScheduleToDate = (state: PersistedState, date: string, events: ScheduleEvent[]) => {
  const weekday = dayjs(date).day() as Weekday;
  const baseEvents = getTemplateForWeekday(state, weekday).events.map((event) => normalizeEvent(event));
  const nextEvents = sortEvents(events.map((event) => normalizeEvent(event)));
  const baseMap = new Map(baseEvents.map((event) => [event.id, event]));
  const seenBaseIds = new Set<string>();
  const updatedEvents: ScheduleEvent[] = [];
  const addedEvents: ScheduleEvent[] = [];

  nextEvents.forEach((event) => {
    const baseEvent = baseMap.get(event.id);

    if (!baseEvent) {
      addedEvents.push(event);
      return;
    }

    seenBaseIds.add(event.id);
    if (!sameEvent(baseEvent, event)) {
      updatedEvents.push(event);
    }
  });

  const removedEventIds = baseEvents
    .filter((event) => !seenBaseIds.has(event.id))
    .map((event) => event.id);

  const nextOverride: DateOverride = {
    date,
    addedEvents,
    updatedEvents,
    removedEventIds,
  };

  const nextOverrides = state.overrides.filter((override) => override.date !== date);
  const hasChanges = addedEvents.length || updatedEvents.length || removedEventIds.length;

  return normalizeState({
    ...state,
    overrides: hasChanges ? [...nextOverrides, nextOverride] : nextOverrides,
  });
};

export const removeEventFromDate = (state: PersistedState, date: string, eventId: string) =>
  applyScheduleToDate(
    state,
    date,
    deriveScheduleForDate(state, date).filter((event) => event.id !== eventId).map(stripOccurrence),
  );

export const reorderDateSchedule = (
  state: PersistedState,
  date: string,
  sourceId: string,
  targetId: string,
) => {
  const schedule = deriveScheduleForDate(state, date).map(stripOccurrence);
  const sourceIndex = schedule.findIndex((event) => event.id === sourceId);
  const targetIndex = schedule.findIndex((event) => event.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return state;
  }

  const slots = sortEvents(schedule).map((event) => ({
    startTime: event.startTime,
    endTime: event.endTime,
  }));
  const reordered = [...sortEvents(schedule)];
  const [moving] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moving);

  const withSlots = reordered.map((event, index) => ({
    ...event,
    startTime: slots[index].startTime,
    endTime: slots[index].endTime,
  }));

  return applyScheduleToDate(state, date, withSlots);
};

export const delayEventForDate = (
  state: PersistedState,
  date: string,
  eventId: string,
  minutes: number,
) => {
  const schedule = deriveScheduleForDate(state, date).map(stripOccurrence);
  const shifted = schedule.map((event) =>
    event.id !== eventId
      ? event
      : {
          ...event,
          startTime: minutesToTime(toMinutes(event.startTime) + minutes),
          endTime: minutesToTime(toMinutes(event.endTime) + minutes),
        },
  );

  return applyScheduleToDate(state, date, shifted);
};

export const startSessionForEvent = (
  state: PersistedState,
  event: ScheduleEvent,
  date: string,
  now = dayjs(),
) => {
  const currentSessions = state.sessions.map((session) => {
    if (session.date !== date || session.status !== 'running' || session.eventId === event.id) {
      return session;
    }

    return {
      ...session,
      actualEnd: now.toISOString(),
      durationMinutes: getSessionActualMinutes(session, now),
      status: 'completed' as const,
    };
  });

  const latest = getLatestSessionForEvent(currentSessions, event.id, date);
  if (latest?.status === 'running') {
    return normalizeState({
      ...state,
      sessions: currentSessions,
    });
  }

  return normalizeState({
    ...state,
    sessions: [
      ...currentSessions,
      {
        id: createId(),
        eventId: event.id,
        date,
        actualStart: now.toISOString(),
        actualEnd: null,
        durationMinutes: 0,
        status: 'running',
      },
    ],
  });
};

export const completeSessionForEvent = (
  state: PersistedState,
  eventId: string,
  date: string,
  status: 'completed' | 'skipped' = 'completed',
  now = dayjs(),
) => {
  let updated = false;

  const sessions = state.sessions.map((session) => {
    if (updated || session.eventId !== eventId || session.date !== date || session.status !== 'running') {
      return session;
    }

    updated = true;
    return {
      ...session,
      actualEnd: now.toISOString(),
      durationMinutes: getSessionActualMinutes(session, now),
      status,
    };
  });

  return updated
    ? normalizeState({
        ...state,
        sessions,
      })
    : state;
};

export const skipEventForDate = (state: PersistedState, eventId: string, date: string, now = dayjs()) => {
  const hasRunning = Boolean(
    state.sessions.find((session) => session.eventId === eventId && session.date === date && session.status === 'running'),
  );

  if (hasRunning) {
    return completeSessionForEvent(state, eventId, date, 'skipped', now);
  }

  return normalizeState({
    ...state,
    sessions: [
      ...state.sessions,
      {
        id: createId(),
        eventId,
        date,
        actualStart: now.toISOString(),
        actualEnd: now.toISOString(),
        durationMinutes: 0,
        status: 'skipped',
      },
    ],
  });
};

export const getSummaryMetrics = (state: PersistedState, date: string, now = dayjs()): SummaryMetrics => {
  const schedule = deriveScheduleForDate(state, date, now);
  const plannedMinutes = schedule.reduce((total, event) => total + event.plannedMinutes, 0);
  const actualMinutes = schedule.reduce((total, event) => total + event.actualMinutes, 0);
  const completedCount = schedule.filter((event) => event.status === 'completed').length;
  const nextEvent =
    schedule.find(
      (event) =>
        event.enabled &&
        (event.status === 'pending' || event.status === 'running') &&
        dayjs(`${date}T${event.endTime}:00`).isAfter(now),
    ) ?? null;

  return {
    plannedMinutes,
    actualMinutes,
    remainingMinutes: schedule
      .filter((event) => event.status === 'pending' || event.status === 'running')
      .reduce((total, event) => total + Math.max(0, event.plannedMinutes - event.actualMinutes), 0),
    completedCount,
    totalCount: schedule.length,
    nextEvent,
  };
};

export const buildStatsSeries = (
  state: PersistedState,
  days: number,
  anchorDate = dayjs().format(DATE_FORMAT),
  now = dayjs(),
): StatsSeriesPoint[] => {
  const anchor = dayjs(anchorDate);

  return Array.from({ length: days }, (_, index) => {
    const date = anchor.subtract(days - index - 1, 'day').format(DATE_FORMAT);
    const summary = getSummaryMetrics(state, date, now);

    return {
      date,
      label: `${WEEKDAYS[dayjs(date).day()].short} ${dayjs(date).format('M/D')}`,
      plannedMinutes: summary.plannedMinutes,
      actualMinutes: summary.actualMinutes,
    };
  });
};

export const buildExportRows = (
  state: PersistedState,
  fromDate: string,
  toDate: string,
  now = dayjs(),
): StatsExportRow[] => {
  const start = dayjs(fromDate);
  const end = dayjs(toDate);
  const rows: StatsExportRow[] = [];

  if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
    return rows;
  }

  let cursor = start.startOf('day');
  while (!cursor.isAfter(end, 'day')) {
    const date = cursor.format(DATE_FORMAT);
    const schedule = deriveScheduleForDate(state, date, now);

    schedule.forEach((event) => {
      rows.push({
        date,
        title: event.title,
        subject: event.subject,
        startTime: event.startTime,
        endTime: event.endTime,
        plannedMinutes: event.plannedMinutes,
        actualMinutes: event.actualMinutes,
        status: event.status,
      });
    });

    cursor = cursor.add(1, 'day');
  }

  return rows;
};

const buildReminderMoments = (event: ScheduleOccurrence) => {
  const { effectiveReminder } = event;
  const start = dayjs(`${event.date}T${event.startTime}:00`);
  const end = dayjs(`${event.date}T${event.endTime}:00`);
  const reminders: Array<{ key: string; label: string; when: Dayjs }> = [];

  if (effectiveReminder.mode === 'off') {
    return reminders;
  }

  if (effectiveReminder.mode === 'before' || effectiveReminder.mode === 'combo') {
    effectiveReminder.beforeMinutes.forEach((minutes) => {
      reminders.push({
        key: `before-${minutes}`,
        label: `${minutes} 分钟后开始`,
        when: start.subtract(minutes, 'minute'),
      });
    });
  }

  if (
    effectiveReminder.mode === 'start' ||
    effectiveReminder.mode === 'combo' ||
    effectiveReminder.notifyAtStart
  ) {
    reminders.push({
      key: 'start',
      label: '现在开始',
      when: start,
    });
  }

  if (effectiveReminder.mode === 'end' || effectiveReminder.mode === 'combo' || effectiveReminder.notifyAtEnd) {
    reminders.push({
      key: 'end',
      label: '现在结束',
      when: end,
    });
  }

  return reminders;
};

const hashToInt = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) || 1;
};

export const buildNotificationPlan = (
  state: PersistedState,
  anchor = dayjs(),
  days = 7,
): NotificationPlanItem[] => {
  const notifications: NotificationPlanItem[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = anchor.startOf('day').add(offset, 'day').format(DATE_FORMAT);
    const schedule = deriveScheduleForDate(state, date, anchor);

    schedule.forEach((event) => {
      if (!event.enabled) {
        return;
      }

      buildReminderMoments(event).forEach((reminder) => {
        if (!reminder.when.isAfter(anchor.add(5, 'second'))) {
          return;
        }

        notifications.push({
          id: hashToInt(`${event.id}-${date}-${reminder.key}-${reminder.when.toISOString()}`),
          title: `${event.subject} · ${event.title}`,
          body: `${reminder.label}｜${event.startTime} - ${event.endTime}`,
          when: reminder.when.toDate(),
        });
      });
    });
  }

  return notifications;
};

export const getReminderDescription = (policy: ReminderPolicy, fallback: ReminderPolicy): string => {
  const effective = getEffectiveReminder(policy, fallback);

  if (policy.mode === 'inherit') {
    return `继承全局 · ${getReminderDescription(effective, effective)}`;
  }

  if (effective.mode === 'off') {
    return '不提醒';
  }

  if (effective.mode === 'before') {
    return `提前 ${effective.beforeMinutes.join(' / ')} 分钟`;
  }

  if (effective.mode === 'start') {
    return '开始时提醒';
  }

  if (effective.mode === 'end') {
    return '结束后提醒';
  }

  const pieces: string[] = [];
  if (effective.beforeMinutes.length) {
    pieces.push(`提前 ${effective.beforeMinutes.join(' / ')} 分钟`);
  }
  if (effective.notifyAtStart) {
    pieces.push('开始时');
  }
  if (effective.notifyAtEnd) {
    pieces.push('结束后');
  }

  return pieces.join(' + ') || '组合提醒';
};

export const getDisplayValue = (summary: SummaryMetrics, mode: AppSettings['statsDisplayMode']) => {
  if (mode === 'hidden') {
    return '已隐藏';
  }

  if (mode === 'planned') {
    return `计划 ${formatMinutes(summary.plannedMinutes)}`;
  }

  if (mode === 'actual') {
    return `实际 ${formatMinutes(summary.actualMinutes)}`;
  }

  return `${formatMinutes(summary.actualMinutes)} / ${formatMinutes(summary.plannedMinutes)}`;
};
