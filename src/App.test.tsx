import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEvent, EMPTY_STATE, normalizeState } from './lib/schedule';
import type { PersistedState, Weekday } from './types';

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

vi.mock('./services/platform', () => mockedPlatform);

import App from './App';
import { APP_VERSION } from './version';

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
              startTime: '10:00',
              endTime: '12:00',
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

describe('App UI', () => {
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
    cleanup();
  });

  it('shows the current app version in the sidebar brand', async () => {
    render(<App />);

    expect(await screen.findByText(`StudyFlow v${APP_VERSION}`)).toBeTruthy();
  });

  it('keeps the selected weekday after switching weekly templates', async () => {
    render(<App />);
    const user = userEvent.setup();

    await screen.findByText('StudyFlow 已就绪');

    const nav = (await screen.findAllByRole('navigation'))[0];
    const weeklyButton = within(nav)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('周模板'));

    expect(weeklyButton).toBeTruthy();
    await user.click(weeklyButton!);

    const tabs = await screen.findByRole('tablist', { name: '选择星期' });
    const weeklyPanel = tabs.closest('.panel');

    expect(weeklyPanel).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: '查看周四模板' }).getAttribute('aria-selected')).toBe('true');

    const fridayTab = within(tabs).getByRole('tab', { name: '查看周五模板' });
    await user.click(fridayTab);

    await waitFor(() => {
      expect(fridayTab.getAttribute('aria-selected')).toBe('true');
      expect(within(weeklyPanel as HTMLElement).getByText('周五规划')).toBeTruthy();
    });

    expect(mockedPlatform.loadPersistedState).toHaveBeenCalledTimes(1);
  });

  it('does not crash when toggling a setting that persists state', async () => {
    render(<App />);
    const user = userEvent.setup();

    await screen.findByText('StudyFlow 已就绪');

    const nav = (await screen.findAllByRole('navigation'))[0];
    const settingsButton = within(nav)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('设置'));

    expect(settingsButton).toBeTruthy();
    await user.click(settingsButton!);

    const launchSetting = await screen.findByText('开机启动');
    const launchSettingRow = launchSetting.closest('.setting-row');

    expect(launchSettingRow).toBeTruthy();

    const autostartButton = within(launchSettingRow as HTMLElement).getByRole('button');
    await user.click(autostartButton);

    await waitFor(() => {
      expect(screen.getByText('开机启动已开启')).toBeTruthy();
    });
  });
});
