import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEvent, EMPTY_STATE, normalizeState } from '../lib/schedule';
import type { PersistedState, Weekday } from '../types';
import { useStudyFlowApp } from './useStudyFlowApp';

const mockedPlatform = vi.hoisted(() => ({
  loadPersistedState: vi.fn<() => Promise<PersistedState>>(),
  persistPlatformState: vi.fn<() => Promise<void>>(),
  listenTrayActions: vi.fn<() => Promise<() => void>>(),
  listenNotificationActions: vi.fn<() => Promise<() => void>>(),
  getNotificationPermission: vi.fn<() => Promise<boolean>>(),
  ensureNotificationPermission: vi.fn<() => Promise<boolean>>(),
  deliverNotification: vi.fn<() => Promise<void>>(),
  exportBackupFile: vi.fn<() => Promise<string | null>>(),
  importBackupFile: vi.fn<() => Promise<PersistedState | null>>(),
  exportCsvFile: vi.fn<() => Promise<string | null>>(),
  confirmOverrideReset: vi.fn<() => Promise<boolean>>(),
  setAutostartEnabled: vi.fn<() => Promise<void>>(),
  showPlatformError: vi.fn<() => Promise<void>>(),
}));

vi.mock('../services/platform', () => mockedPlatform);

const THURSDAY = 4 as Weekday;
const FRIDAY = 5 as Weekday;

const buildState = () =>
  normalizeState({
    ...EMPTY_STATE,
    templates: EMPTY_STATE.templates.map((template) => {
      if (template.weekday === THURSDAY) {
        return {
          ...template,
          events: [
            createEvent({
              title: '周四复习',
              subject: '英语',
              startTime: '19:00',
              endTime: '20:00',
            }),
          ],
        };
      }

      if (template.weekday === FRIDAY) {
        return {
          ...template,
          events: [
            createEvent({
              title: '周五规划',
              subject: '数学',
              startTime: '08:00',
              endTime: '09:00',
            }),
          ],
        };
      }

      return template;
    }),
  });

describe('useStudyFlowApp', () => {
  beforeEach(() => {
    mockedPlatform.loadPersistedState.mockResolvedValue(buildState());
    mockedPlatform.persistPlatformState.mockResolvedValue();
    mockedPlatform.listenTrayActions.mockResolvedValue(() => {});
    mockedPlatform.listenNotificationActions.mockResolvedValue(() => {});
    mockedPlatform.getNotificationPermission.mockResolvedValue(false);
    mockedPlatform.ensureNotificationPermission.mockResolvedValue(false);
    mockedPlatform.exportBackupFile.mockResolvedValue(null);
    mockedPlatform.importBackupFile.mockResolvedValue(null);
    mockedPlatform.exportCsvFile.mockResolvedValue(null);
    mockedPlatform.confirmOverrideReset.mockResolvedValue(true);
    mockedPlatform.setAutostartEnabled.mockResolvedValue();
    mockedPlatform.showPlatformError.mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('switches the selected template when the weekday changes', async () => {
    const { result } = renderHook(() => useStudyFlowApp());

    await waitFor(() => {
      expect(result.current.selectedTemplate.events[0]?.title).toBe('周四复习');
    });

    act(() => {
      result.current.setSelectedWeekday(FRIDAY);
    });

    await waitFor(() => {
      expect(result.current.selectedTemplate.events[0]?.title).toBe('周五规划');
    });
  });
});
