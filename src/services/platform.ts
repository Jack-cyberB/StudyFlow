import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { confirm, message, open, save } from '@tauri-apps/plugin-dialog';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import dayjs from 'dayjs';

import { EMPTY_STATE, normalizeState } from '../lib/schedule';
import type { NotificationPlanItem, PersistedState, StatsExportRow } from '../types';

const STORAGE_KEY = 'studyflow-browser-state';

export const isTauriApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const readBrowserState = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
};

const writeBrowserState = (payload: PersistedState) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const downloadTextFile = (fileName: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export const showPlatformError = async (title: string, description: string) => {
  if (isTauriApp) {
    await message(description, { title, kind: 'error' });
    return;
  }

  window.alert(`${title}\n\n${description}`);
};

export const loadPersistedState = async () => {
  if (!isTauriApp) {
    return readBrowserState();
  }

  let initial = normalizeState(await invoke<PersistedState>('load_state'));
  const startupEnabled = await isEnabled().catch(() => initial.settings.launchAtStartup);
  initial = normalizeState({
    ...initial,
    settings: {
      ...initial.settings,
      launchAtStartup: startupEnabled,
    },
  });

  return initial;
};

export const persistPlatformState = async (payload: PersistedState) => {
  if (isTauriApp) {
    await invoke('persist_state', { payload });
    return;
  }

  writeBrowserState(payload);
};

export const setAutostartEnabled = async (enabled: boolean) => {
  if (!isTauriApp) {
    return;
  }

  if (enabled) {
    await enable();
    return;
  }

  await disable();
};

export const getNotificationPermission = async () => {
  if (!isTauriApp) {
    return false;
  }

  return (await isPermissionGranted().catch(() => false)) || false;
};

export const ensureNotificationPermission = async () => {
  if (!isTauriApp) {
    return false;
  }

  let granted = await isPermissionGranted().catch(() => false);
  if (!granted) {
    granted = (await requestPermission().catch(() => 'denied')) === 'granted';
  }

  return granted;
};

export const deliverNotification = (item: NotificationPlanItem) => {
  sendNotification({
    title: item.title,
    body: item.body,
  });
};

export const listenTrayActions = async (handlers: {
  onOpenToday: () => void;
  onToggleNotifications: () => void;
}) => {
  if (!isTauriApp) {
    return () => {};
  }

  const disposeOpen = await listen('tray-open-today', handlers.onOpenToday);
  const disposeToggle = await listen('tray-toggle-notifications', handlers.onToggleNotifications);

  return () => {
    disposeOpen();
    disposeToggle();
  };
};

export const exportBackupFile = async (payload: PersistedState) => {
  if (isTauriApp) {
    const filePath = await save({
      title: '导出备份',
      defaultPath: `studyflow-backup-${dayjs().format('YYYYMMDD-HHmm')}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });

    if (!filePath) {
      return null;
    }

    await invoke<string>('export_backup', { filePath, payload });
    return filePath;
  }

  const fileName = `studyflow-backup-${dayjs().format('YYYYMMDD-HHmm')}.json`;
  downloadTextFile(fileName, JSON.stringify(payload, null, 2), 'application/json');
  return fileName;
};

export const importBackupFile = async () => {
  if (isTauriApp) {
    const filePath = await open({
      title: '导入备份',
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });

    if (!filePath || Array.isArray(filePath)) {
      return null;
    }

    return normalizeState(await invoke<PersistedState>('import_backup', { filePath }));
  }

  return await new Promise<PersistedState | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.click();
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      file
        .text()
        .then((text) => {
          const payload = normalizeState(JSON.parse(text));
          writeBrowserState(payload);
          resolve(payload);
        })
        .catch(reject);
    };
  });
};

export const exportCsvFile = async (rows: StatsExportRow[], range: { from: string; to: string }) => {
  if (isTauriApp) {
    const filePath = await save({
      title: '导出统计 CSV',
      defaultPath: `studyflow-stats-${range.from}-to-${range.to}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (!filePath) {
      return null;
    }

    await invoke<string>('export_csv', { filePath, rows });
    return filePath;
  }

  const header = 'date,title,subject,startTime,endTime,plannedMinutes,actualMinutes,status\n';
  const body = rows
    .map((row) =>
      [
        row.date,
        row.title,
        row.subject,
        row.startTime,
        row.endTime,
        row.plannedMinutes,
        row.actualMinutes,
        row.status,
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
    .join('\n');

  const fileName = `studyflow-stats-${range.from}-to-${range.to}.csv`;
  downloadTextFile(fileName, `${header}${body}`, 'text/csv');
  return fileName;
};

export const confirmOverrideReset = async () => {
  if (isTauriApp) {
    return await confirm('这会清空当前日期的临时改动，并恢复为周模板内容。', {
      title: '清空日期例外',
      kind: 'warning',
      okLabel: '清空',
      cancelLabel: '取消',
    });
  }

  return window.confirm('这会清空当前日期的临时改动，并恢复为周模板内容。');
};
