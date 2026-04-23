import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_STATE, normalizeState } from './lib/schedule';
import type { PersistedState } from './types';

const mockedPlatform = vi.hoisted(() => ({
  loadPersistedState: vi.fn<() => Promise<PersistedState>>(),
  persistPlatformState: vi.fn<() => Promise<void>>(),
  listenTrayActions: vi.fn<() => Promise<() => void>>(),
  getNotificationPermission: vi.fn<() => Promise<boolean>>(),
  ensureNotificationPermission: vi.fn<() => Promise<boolean>>(),
  deliverNotification: vi.fn(),
  exportBackupFile: vi.fn<() => Promise<string | null>>(),
  importBackupFile: vi.fn<() => Promise<PersistedState | null>>(),
  exportCsvFile: vi.fn<() => Promise<string | null>>(),
  confirmOverrideReset: vi.fn<() => Promise<boolean>>(),
  setAutostartEnabled: vi.fn<() => Promise<void>>(),
  showPlatformError: vi.fn<() => Promise<void>>(),
}));

vi.mock('./services/platform', () => mockedPlatform);

import App from './App';

describe('App UI', () => {
  beforeEach(() => {
    mockedPlatform.loadPersistedState.mockResolvedValue(normalizeState(EMPTY_STATE));
    mockedPlatform.persistPlatformState.mockResolvedValue();
    mockedPlatform.listenTrayActions.mockResolvedValue(() => {});
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

    expect(await screen.findByText('StudyFlow v1.0.1')).toBeTruthy();
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
