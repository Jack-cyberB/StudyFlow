import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import {
  applyScheduleToDate,
  autoCompleteExpiredSessions,
  buildNotificationPlan,
  buildExportRows,
  createEvent,
  EMPTY_STATE,
  normalizeState,
  reorderDateSchedule,
  startSessionForEvent,
  upsertTemplateEvent,
} from './schedule';
import type { PersistedState, ScheduleEvent, Weekday } from '../types';

const MONDAY = 1 as Weekday;
const MONDAY_DATE = '2026-04-20';

const makeEvent = (overrides?: Partial<ScheduleEvent>) =>
  createEvent({
    title: '数学',
    subject: '刷题',
    startTime: '09:00',
    endTime: '10:00',
    ...overrides,
  });

const makeStateWithTemplate = (...events: ScheduleEvent[]): PersistedState =>
  normalizeState({
    ...EMPTY_STATE,
    templates: EMPTY_STATE.templates.map((template) =>
      template.weekday === MONDAY ? { ...template, events } : template,
    ),
  });

describe('schedule helpers', () => {
  it('creates date overrides without mutating the weekly template', () => {
    const templateEvent = makeEvent();
    const extraEvent = makeEvent({
      title: '英语',
      subject: '听力',
      startTime: '14:00',
      endTime: '15:00',
    });
    const state = makeStateWithTemplate(templateEvent);

    const next = applyScheduleToDate(state, MONDAY_DATE, [templateEvent, extraEvent]);

    expect(next.templates.find((template) => template.weekday === MONDAY)?.events).toHaveLength(1);
    expect(next.overrides).toHaveLength(1);
    expect(next.overrides[0].addedEvents).toHaveLength(1);
    expect(next.overrides[0].addedEvents[0].title).toBe('英语');
  });

  it('reorders date schedules by swapping time slots in the override layer', () => {
    const first = makeEvent({ title: '数学', startTime: '09:00', endTime: '10:00' });
    const second = makeEvent({ title: '物理', startTime: '10:00', endTime: '11:00' });
    const base = makeStateWithTemplate(first, second);

    const reordered = reorderDateSchedule(base, MONDAY_DATE, second.id, first.id);
    const updatedEvents = reordered.overrides[0]?.updatedEvents ?? [];

    expect(updatedEvents).toHaveLength(2);
    expect(updatedEvents.find((event) => event.id === second.id)?.startTime).toBe('09:00');
    expect(updatedEvents.find((event) => event.id === first.id)?.startTime).toBe('10:00');
  });

  it('builds notifications only for future reminder points', () => {
    const state = makeStateWithTemplate(
      makeEvent({
        reminderPolicy: {
          mode: 'before',
          beforeMinutes: [15],
          notifyAtStart: false,
          notifyAtEnd: false,
        },
      }),
    );

    const anchor = dayjs(`${MONDAY_DATE}T08:30:00`);
    const plan = buildNotificationPlan(state, anchor, 1);

    expect(plan).toHaveLength(1);
    expect(plan[0].title).toContain('刷题');
    expect(plan[0].when.toISOString()).toContain('2026-04-20T00:45:00.000Z');
  });

  it('exports rows with accumulated actual study minutes', () => {
    const event = makeEvent();
    const state = makeStateWithTemplate(event);
    const started = startSessionForEvent(state, event, MONDAY_DATE, dayjs(`${MONDAY_DATE}T09:00:00`));
    const completed = normalizeState({
      ...started,
      sessions: started.sessions.map((session) => ({
        ...session,
        actualEnd: `${MONDAY_DATE}T09:45:00.000Z`,
        durationMinutes: 45,
        status: 'completed',
      })),
    });

    const rows = buildExportRows(completed, MONDAY_DATE, MONDAY_DATE, dayjs(`${MONDAY_DATE}T12:00:00`));

    expect(rows).toHaveLength(1);
    expect(rows[0].plannedMinutes).toBe(60);
    expect(rows[0].actualMinutes).toBe(45);
    expect(rows[0].status).toBe('completed');
  });

  it('waits 10 minutes after the scheduled end time before auto-completing a running session', () => {
    const event = makeEvent();
    const state = makeStateWithTemplate(event);
    const started = startSessionForEvent(state, event, MONDAY_DATE, dayjs(`${MONDAY_DATE}T09:00:00`));

    const stillRunning = autoCompleteExpiredSessions(started, dayjs(`${MONDAY_DATE}T10:09:00`));
    const reconciled = autoCompleteExpiredSessions(started, dayjs(`${MONDAY_DATE}T10:10:00`));

    expect(stillRunning.sessions[0].status).toBe('running');
    expect(reconciled.sessions).toHaveLength(1);
    expect(reconciled.sessions[0].status).toBe('completed');
    expect(reconciled.sessions[0].durationMinutes).toBe(60);
    expect(reconciled.sessions[0].actualEnd).toContain('2026-04-20T02:00:00.000Z');
  });

  it('starting a new study block closes any other running block first', () => {
    const first = makeEvent({ title: '数学', startTime: '09:00', endTime: '10:00' });
    const second = makeEvent({ title: '英语', startTime: '10:00', endTime: '11:00' });
    const state = makeStateWithTemplate(first, second);

    const firstStarted = startSessionForEvent(state, first, MONDAY_DATE, dayjs(`${MONDAY_DATE}T09:10:00`));
    const secondStarted = startSessionForEvent(firstStarted, second, MONDAY_DATE, dayjs(`${MONDAY_DATE}T10:05:00`));

    expect(secondStarted.sessions.filter((session) => session.status === 'running')).toHaveLength(1);
    expect(secondStarted.sessions.find((session) => session.eventId === first.id)?.status).toBe('completed');
    expect(secondStarted.sessions.find((session) => session.eventId === first.id)?.durationMinutes).toBe(50);
  });

  it('upserts template events into the matching weekday only', () => {
    const state = upsertTemplateEvent(EMPTY_STATE, MONDAY, makeEvent());

    expect(state.templates.find((template) => template.weekday === MONDAY)?.events).toHaveLength(1);
    expect(state.templates.filter((template) => template.weekday !== MONDAY).every((template) => template.events.length === 0)).toBe(true);
  });
});
