import {
  type ReactNode,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
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

import {
  applyScheduleToDate,
  buildExportRows,
  buildNotificationPlan,
  buildStatsSeries,
  COLOR_SWATCHES,
  copyTemplateToWeekdays,
  createEvent,
  DATE_FORMAT,
  delayEventForDate,
  deriveScheduleForDate,
  EMPTY_STATE,
  getDisplayValue,
  getOverrideForDate,
  getReminderDescription,
  getSummaryMetrics,
  getTemplateForWeekday,
  getWeekdayLabel,
  normalizeReminderPolicy,
  normalizeStatsDisplayMode,
  normalizeState,
  removeEventFromDate,
  removeTemplateEvent,
  reorderDateSchedule,
  skipEventForDate,
  startSessionForEvent,
  stripOccurrence,
  suggestEventSlot,
  upsertTemplateEvent,
  WEEKDAYS,
  completeSessionForEvent,
  formatMinutes,
} from './lib/schedule';
import './styles.css';
import type {
  PersistedState,
  ReminderMode,
  ReminderPolicy,
  ScheduleEvent,
  StatsDisplayMode,
  ViewKey,
  Weekday,
} from './types';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const STORAGE_KEY = 'studyflow-browser-state';

type EditorState =
  | { scope: 'weekly'; weekday: Weekday; event: ScheduleEvent }
  | { scope: 'date'; date: string; event: ScheduleEvent };

const VIEW_ITEMS: Array<{ key: ViewKey; label: string; caption: string }> = [
  { key: 'today', label: '今日', caption: '时间线与专注进度' },
  { key: 'weekly', label: '周模板', caption: '按星期固定排程' },
  { key: 'overrides', label: '日历例外', caption: '对单独日期做临时调整' },
  { key: 'stats', label: '统计', caption: '学习时长与导出' },
  { key: 'settings', label: '设置', caption: '通知、托盘与备份' },
];

const parseReminderMinutes = (value: string, fallback: number[]) => {
  const parsed = value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);

  return parsed.length ? [...new Set(parsed)].sort((left, right) => right - left) : fallback;
};

const applyReminderMode = (policy: ReminderPolicy, mode: ReminderMode) => {
  if (mode === 'inherit') {
    return normalizeReminderPolicy({ mode }, true);
  }
  if (mode === 'off') {
    return normalizeReminderPolicy({ mode, beforeMinutes: policy.beforeMinutes }, false);
  }
  if (mode === 'before') {
    return normalizeReminderPolicy({ mode, beforeMinutes: policy.beforeMinutes }, false);
  }
  if (mode === 'start') {
    return normalizeReminderPolicy({ mode, beforeMinutes: policy.beforeMinutes, notifyAtStart: true }, false);
  }
  if (mode === 'end') {
    return normalizeReminderPolicy({ mode, beforeMinutes: policy.beforeMinutes, notifyAtEnd: true }, false);
  }
  return normalizeReminderPolicy(
    {
      mode,
      beforeMinutes: policy.beforeMinutes,
      notifyAtStart: true,
      notifyAtEnd: true,
    },
    false,
  );
};

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

const getDefaultDate = () => dayjs().format(DATE_FORMAT);

const buildDraftEvent = (events: ScheduleEvent[], subject = '自习') => {
  const slot = suggestEventSlot(events);
  return createEvent({
    title: '新的学习块',
    subject,
    startTime: slot.startTime,
    endTime: slot.endTime,
    color: COLOR_SWATCHES[events.length % COLOR_SWATCHES.length],
  });
};

const toShortDate = (date: string) => {
  const weekday = WEEKDAYS[dayjs(date).day()];
  return `${dayjs(date).format('M 月 D 日')} · ${weekday.short}`;
};

function App() {
  const [state, setState] = useState<PersistedState>(EMPTY_STATE);
  const [view, setView] = useState<ViewKey>('today');
  const [selectedDate, setSelectedDate] = useState(getDefaultDate);
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday>(dayjs().day() as Weekday);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [copyTargets, setCopyTargets] = useState<Weekday[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('正在载入本地日程...');
  const [notificationsPaused, setNotificationsPaused] = useState(false);
  const [notificationReady, setNotificationReady] = useState(false);
  const [now, setNow] = useState(dayjs());
  const [statsRange, setStatsRange] = useState({
    from: dayjs().subtract(6, 'day').format(DATE_FORMAT),
    to: dayjs().format(DATE_FORMAT),
  });
  const stateRef = useRef(state);
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const notificationTimeoutsRef = useRef<number[]>([]);
  const deliveredNotificationsRef = useRef<Set<number>>(new Set());

  const todayKey = now.format(DATE_FORMAT);
  const safeStatsDisplayMode = normalizeStatsDisplayMode(state.settings.statsDisplayMode);
  const selectedTemplate = useMemo(() => getTemplateForWeekday(state, selectedWeekday), [state, selectedWeekday]);
  const daySchedule = useMemo(() => deriveScheduleForDate(state, selectedDate, now), [state, selectedDate, now]);
  const selectedOverride = useMemo(() => getOverrideForDate(state, selectedDate), [state, selectedDate]);
  const summary = useMemo(() => getSummaryMetrics(state, selectedDate, now), [state, selectedDate, now]);
  const statsSeries = useMemo(() => buildStatsSeries(state, 7, todayKey, now), [state, todayKey, now]);
  const exportRows = useMemo(
    () => buildExportRows(state, statsRange.from, statsRange.to, now),
    [state, statsRange.from, statsRange.to, now],
  );
  const deferredExportRows = useDeferredValue(exportRows);
  const activeConflictCount = daySchedule.filter((item) => item.conflict).length;

  const showFeedback = useEffectEvent((value: string) => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(value);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 3200);
  });

  const showError = useEffectEvent(async (title: string, description: string) => {
    if (IS_TAURI) {
      await message(description, { title, kind: 'error' });
      return;
    }
    window.alert(`${title}\n\n${description}`);
  });

  const persistState = useEffectEvent(async (payload: PersistedState) => {
    try {
      if (IS_TAURI) {
        await invoke('persist_state', { payload });
      } else {
        writeBrowserState(payload);
      }
    } catch (error) {
      await showError('保存失败', `未能写入本地数据：${String(error)}`);
    }
  });

  const commitState = (updater: (current: PersistedState) => PersistedState, notice?: string) => {
    setState((current) => {
      const next = normalizeState(updater(current));
      stateRef.current = next;
      void persistState(next);
      return next;
    });

    if (notice) {
      showFeedback(notice);
    }
  };

  const syncAutostartPreference = useEffectEvent(async (enabled: boolean) => {
    if (!IS_TAURI) {
      return;
    }
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
  });

  const loadApp = useEffectEvent(async () => {
    try {
      let initial = EMPTY_STATE;

      if (IS_TAURI) {
        initial = normalizeState(await invoke<PersistedState>('load_state'));
        const startupEnabled = await isEnabled().catch(() => initial.settings.launchAtStartup);
        initial = normalizeState({
          ...initial,
          settings: {
            ...initial.settings,
            launchAtStartup: startupEnabled,
          },
        });
      } else {
        initial = readBrowserState();
      }

      stateRef.current = initial;
      setState(initial);
      setSelectedWeekday(dayjs().day() as Weekday);
      setLoading(false);
      setFeedback('StudyFlow 已就绪');

      if (IS_TAURI) {
        const granted = (await isPermissionGranted().catch(() => false)) || false;
        setNotificationReady(granted);
      }
    } catch (error) {
      setLoading(false);
      await showError('启动失败', `无法读取应用数据：${String(error)}`);
    }
  });

  useEffect(() => {
    void loadApp();

    return () => {
      window.clearTimeout(feedbackTimerRef.current);
      notificationTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, [loadApp]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(dayjs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!IS_TAURI) {
      return undefined;
    }

    let disposeOpen = () => {};
    let disposeToggle = () => {};

    const attach = async () => {
      disposeOpen = await listen('tray-open-today', () => {
        startTransition(() => {
          setView('today');
          setSelectedDate(getDefaultDate());
        });
        showFeedback('已从托盘打开今日视图');
      });

      disposeToggle = await listen('tray-toggle-notifications', () => {
        setNotificationsPaused((current) => {
          const next = !current;
          showFeedback(next ? '提醒已暂停' : '提醒已恢复');
          return next;
        });
      });
    };

    void attach();

    return () => {
      disposeOpen();
      disposeToggle();
    };
  }, [showFeedback]);

  const ensureNotificationPermission = useEffectEvent(async () => {
    if (!IS_TAURI) {
      return false;
    }

    let granted = await isPermissionGranted().catch(() => false);
    if (!granted) {
      granted = (await requestPermission().catch(() => 'denied')) === 'granted';
    }

    setNotificationReady(granted);
    return granted;
  });

  const syncNotifications = useEffectEvent(async () => {
    if (!IS_TAURI || loading) {
      return;
    }

    try {
      notificationTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
      notificationTimeoutsRef.current = [];
      deliveredNotificationsRef.current.clear();

      if (notificationsPaused) {
        return;
      }

      const granted = await ensureNotificationPermission();
      if (!granted) {
        return;
      }

      const plan = buildNotificationPlan(stateRef.current, now, 7);
      plan.forEach((item) => {
        const delay = item.when.getTime() - Date.now();
        if (delay <= 0) {
          return;
        }

        const timer = window.setTimeout(() => {
          if (deliveredNotificationsRef.current.has(item.id)) {
            return;
          }

          deliveredNotificationsRef.current.add(item.id);
          sendNotification({
            title: item.title,
            body: item.body,
          });
        }, delay);

        notificationTimeoutsRef.current.push(timer);
      });
    } catch (error) {
      showFeedback(`提醒同步失败：${String(error)}`);
    }
  });

  useEffect(() => {
    void syncNotifications();
  }, [state, notificationsPaused, todayKey, loading, syncNotifications]);

  const openWeeklyEditor = (event?: ScheduleEvent) => {
    const draft = event ? createEvent(event) : buildDraftEvent(selectedTemplate.events);
    setEditor({ scope: 'weekly', weekday: selectedWeekday, event: draft });
  };

  const openDateEditor = (event?: ScheduleEvent) => {
    const draft = event
      ? createEvent(event)
      : buildDraftEvent(daySchedule.map(stripOccurrence), daySchedule.at(-1)?.subject ?? '自习');
    setEditor({ scope: 'date', date: selectedDate, event: draft });
  };

  const handleSaveEditor = (event: ScheduleEvent) => {
    if (!editor) {
      return;
    }

    if (editor.scope === 'weekly') {
      commitState(
        (current) => upsertTemplateEvent(current, editor.weekday, event),
        `${getWeekdayLabel(editor.weekday)} 模板已保存`,
      );
    } else {
      commitState((current) => {
        const currentSchedule = deriveScheduleForDate(current, editor.date).map(stripOccurrence);
        const nextSchedule = currentSchedule.some((item) => item.id === event.id)
          ? currentSchedule.map((item) => (item.id === event.id ? event : item))
          : [...currentSchedule, event];

        return applyScheduleToDate(current, editor.date, nextSchedule);
      }, `${editor.date} 的例外安排已更新`);
    }

    setEditor(null);
  };

  const handleDeleteWeeklyEvent = (eventId: string) => {
    commitState(
      (current) => removeTemplateEvent(current, selectedWeekday, eventId),
      `${getWeekdayLabel(selectedWeekday)} 模板已删除一项`,
    );
  };

  const handleDeleteDateEvent = (eventId: string) => {
    commitState(
      (current) => removeEventFromDate(current, selectedDate, eventId),
      `${selectedDate} 的安排已移除`,
    );
  };

  const handleReorder = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      return;
    }

    commitState(
      (current) => reorderDateSchedule(current, selectedDate, draggingId, targetId),
      `${toShortDate(selectedDate)} 的顺序已调整`,
    );
    setDraggingId(null);
  };

  const handleCopyTemplate = () => {
    if (!copyTargets.length) {
      showFeedback('先选择要覆盖的星期');
      return;
    }

    commitState(
      (current) => copyTemplateToWeekdays(current, selectedWeekday, copyTargets),
      `${getWeekdayLabel(selectedWeekday)} 的模板已复制`,
    );
    setCopyTargets([]);
  };

  const handleExportBackup = async () => {
    try {
      if (IS_TAURI) {
        const filePath = await save({
          title: '导出备份',
          defaultPath: `studyflow-backup-${dayjs().format('YYYYMMDD-HHmm')}.json`,
          filters: [{ name: 'JSON Backup', extensions: ['json'] }],
        });

        if (!filePath) {
          return;
        }

        await invoke<string>('export_backup', { filePath, payload: stateRef.current });
        showFeedback(`备份已导出到 ${filePath}`);
        return;
      }

      downloadTextFile(
        `studyflow-backup-${dayjs().format('YYYYMMDD-HHmm')}.json`,
        JSON.stringify(stateRef.current, null, 2),
        'application/json',
      );
      showFeedback('浏览器备份已下载');
    } catch (error) {
      await showError('导出失败', `无法写出备份文件：${String(error)}`);
    }
  };

  const handleImportBackup = async () => {
    try {
      if (IS_TAURI) {
        const filePath = await open({
          title: '导入备份',
          filters: [{ name: 'JSON Backup', extensions: ['json'] }],
        });

        if (!filePath || Array.isArray(filePath)) {
          return;
        }

        const imported = normalizeState(await invoke<PersistedState>('import_backup', { filePath }));
        stateRef.current = imported;
        setState(imported);
        await syncAutostartPreference(imported.settings.launchAtStartup);
        showFeedback('备份已恢复');
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.click();
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          return;
        }

        file.text().then((text) => {
          const payload = normalizeState(JSON.parse(text));
          stateRef.current = payload;
          setState(payload);
          writeBrowserState(payload);
          showFeedback('浏览器备份已恢复');
        });
      };
    } catch (error) {
      await showError('导入失败', `备份文件无法读取：${String(error)}`);
    }
  };

  const handleExportCsv = async () => {
    try {
      if (IS_TAURI) {
        const filePath = await save({
          title: '导出统计 CSV',
          defaultPath: `studyflow-stats-${statsRange.from}-to-${statsRange.to}.csv`,
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        });

        if (!filePath) {
          return;
        }

        await invoke<string>('export_csv', { filePath, rows: deferredExportRows });
        showFeedback(`CSV 已导出到 ${filePath}`);
        return;
      }

      const header = 'date,title,subject,startTime,endTime,plannedMinutes,actualMinutes,status\n';
      const body = deferredExportRows
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
      downloadTextFile(`studyflow-stats-${statsRange.from}-to-${statsRange.to}.csv`, `${header}${body}`, 'text/csv');
      showFeedback('浏览器 CSV 已下载');
    } catch (error) {
      await showError('导出失败', `无法生成 CSV：${String(error)}`);
    }
  };

  const clearSelectedOverride = async () => {
    const ok = IS_TAURI
      ? await confirm('这会移除当前日期的全部临时改动，并恢复到周模板。', {
          title: '清空日历例外',
          kind: 'warning',
          okLabel: '清空',
          cancelLabel: '取消',
        })
      : window.confirm('这会移除当前日期的全部临时改动，并恢复到周模板。');

    if (!ok) {
      return;
    }

    commitState(
      (current) => ({
        ...current,
        overrides: current.overrides.filter((item) => item.date !== selectedDate),
      }),
      `${selectedDate} 已恢复为周模板`,
    );
  };

  const handleAutostartToggle = async (enabled: boolean) => {
    try {
      await syncAutostartPreference(enabled);
      commitState(
        (current) => ({
          ...current,
          settings: {
            ...current.settings,
            launchAtStartup: enabled,
          },
        }),
        enabled ? '已开启开机启动' : '已关闭开机启动',
      );
    } catch (error) {
      await showError('设置失败', `无法更新开机启动状态：${String(error)}`);
    }
  };

  const statsTotalPlanned = deferredExportRows.reduce((total, row) => total + row.plannedMinutes, 0);
  const statsTotalActual = deferredExportRows.reduce((total, row) => total + row.actualMinutes, 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <img className="brand-mark" src="/favicon.svg" alt="StudyFlow 图标" />
          <div>
            <p className="eyebrow">StudyFlow</p>
            <h1>学习日程桌面板</h1>
            <p className="muted">
              按星期布置固定节奏，再对当天做灵活修订。轻量、离线、适合长期挂在桌面。
            </p>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx('nav-button', view === item.key && 'is-active')}
              onClick={() => setView(item.key)}
            >
              <span>{item.label}</span>
              <small>{item.caption}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <p className="eyebrow">今日总学习时长</p>
          <strong className="big-number">
            {getDisplayValue(getSummaryMetrics(state, todayKey, now), safeStatsDisplayMode)}
          </strong>
          <p className="muted">
            {notificationsPaused ? '通知当前已暂停。' : notificationReady ? '系统通知已就绪。' : '尚未授予通知权限。'}
          </p>
        </div>

        {feedback ? <div className="status-pill">{feedback}</div> : null}
      </aside>

      <main className="workspace">
        <header className="hero-panel">
          <div>
            <p className="eyebrow">{toShortDate(selectedDate)}</p>
            <h2>把时间块安排成你愿意重复的节奏</h2>
            <p className="muted">今日总览、模板复制、例外修正和学习时长统计都在同一处完成。</p>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setSelectedDate(dayjs(selectedDate).subtract(1, 'day').format(DATE_FORMAT))}
            >
              前一天
            </button>
            <input
              className="date-input"
              type="date"
              value={selectedDate}
              onChange={(event) => {
                const value = event.target.value || todayKey;
                startTransition(() => {
                  setSelectedDate(value);
                  setSelectedWeekday(dayjs(value).day() as Weekday);
                });
              }}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => setSelectedDate(dayjs(selectedDate).add(1, 'day').format(DATE_FORMAT))}
            >
              后一天
            </button>
          </div>
        </header>

        <section className="summary-grid">
          <MetricCard label="计划学习" value={formatMinutes(summary.plannedMinutes)} hint={`${summary.totalCount} 个事件`} />
          <MetricCard label="实际投入" value={formatMinutes(summary.actualMinutes)} hint="已开始和已完成的会话都会计入" />
          <MetricCard label="剩余时长" value={formatMinutes(summary.remainingMinutes)} hint={`${summary.completedCount} / ${summary.totalCount} 已完成`} accent />
          <MetricCard
            label="下一个节点"
            value={summary.nextEvent ? `${summary.nextEvent.subject} · ${summary.nextEvent.startTime}` : '今天已收尾'}
            hint={summary.nextEvent ? summary.nextEvent.title : '没有待开始的学习块'}
          />
        </section>

        {view === 'today' ? (
          <TodayPage
            selectedDate={selectedDate}
            schedule={daySchedule}
            summary={summary}
            selectedOverride={Boolean(selectedOverride)}
            conflictCount={activeConflictCount}
            onCreate={() => openDateEditor()}
            onEdit={(event) => openDateEditor(event)}
            onDelete={handleDeleteDateEvent}
            onStart={(event) =>
              commitState(
                (current) => startSessionForEvent(current, event, selectedDate, dayjs()),
                `${event.title} 已开始计时`,
              )
            }
            onComplete={(eventId, title) =>
              commitState(
                (current) => completeSessionForEvent(current, eventId, selectedDate, 'completed', dayjs()),
                `${title} 已结束`,
              )
            }
            onDelay={(eventId, title) =>
              commitState(
                (current) => delayEventForDate(current, selectedDate, eventId, 10),
                `${title} 已顺延 10 分钟`,
              )
            }
            onSkip={(eventId, title) =>
              commitState(
                (current) => skipEventForDate(current, eventId, selectedDate, dayjs()),
                `${title} 已标记跳过`,
              )
            }
            draggingId={draggingId}
            onDragStart={setDraggingId}
            onDragEnd={() => setDraggingId(null)}
            onDrop={handleReorder}
            onJump={(targetView) => setView(targetView)}
          />
        ) : null}

        {view === 'weekly' ? (
          <WeeklyPage
            weekday={selectedWeekday}
            template={selectedTemplate.events}
            copyTargets={copyTargets}
            settingsReminder={state.settings.defaultReminderPolicy}
            onSelectWeekday={setSelectedWeekday}
            onOpenCreate={() => openWeeklyEditor()}
            onEdit={(event) => openWeeklyEditor(event)}
            onDelete={handleDeleteWeeklyEvent}
            onToggleCopyTarget={(weekday) =>
              setCopyTargets((current) =>
                current.includes(weekday)
                  ? current.filter((value) => value !== weekday)
                  : [...current, weekday],
              )
            }
            onCopyTemplate={handleCopyTemplate}
          />
        ) : null}

        {view === 'overrides' ? (
          <OverridesPage
            selectedDate={selectedDate}
            schedule={daySchedule}
            hasOverride={Boolean(selectedOverride)}
            conflictCount={activeConflictCount}
            onCreate={() => openDateEditor()}
            onEdit={(event) => openDateEditor(event)}
            onDelete={handleDeleteDateEvent}
            onClear={() => {
              void clearSelectedOverride();
            }}
          />
        ) : null}

        {view === 'stats' ? (
          <StatsPage
            statsSeries={statsSeries}
            range={statsRange}
            rows={deferredExportRows}
            totalPlanned={statsTotalPlanned}
            totalActual={statsTotalActual}
            onRangeChange={(nextRange) => setStatsRange(nextRange)}
            onExport={() => {
              void handleExportCsv();
            }}
          />
        ) : null}

        {view === 'settings' ? (
          <SettingsPage
            settings={state.settings}
            notificationsPaused={notificationsPaused}
            notificationReady={notificationReady}
            onToggleAutostart={(enabled) => {
              void handleAutostartToggle(enabled);
            }}
            onToggleTray={(enabled) =>
              commitState(
                (current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    minimizeToTray: enabled,
                  },
                }),
                enabled ? '关闭窗口时会最小化到托盘' : '关闭窗口时将直接退出',
              )
            }
            onToggleNotifications={setNotificationsPaused}
            onStatsModeChange={(mode) =>
              commitState(
                (current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    statsDisplayMode: normalizeStatsDisplayMode(mode),
                  },
                }),
                '统计展示方式已更新',
              )
            }
            onReminderChange={(policy) =>
              commitState(
                (current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    defaultReminderPolicy: normalizeReminderPolicy(policy, false),
                  },
                }),
                '全局提醒策略已更新',
              )
            }
            onExportBackup={() => {
              void handleExportBackup();
            }}
            onImportBackup={() => {
              void handleImportBackup();
            }}
          />
        ) : null}

      </main>

      {editor ? (
        <EventEditorPanel
          key={`${editor.scope}-${editor.scope === 'weekly' ? editor.weekday : editor.date}-${editor.event.id}`}
          title={editor.scope === 'weekly' ? `${getWeekdayLabel(editor.weekday)} 模板事件` : `${editor.date} 临时事件`}
          initialEvent={editor.event}
          globalReminder={state.settings.defaultReminderPolicy}
          onCancel={() => setEditor(null)}
          onSave={handleSaveEditor}
        />
      ) : null}
    </div>
  );
}

function TodayPage({
  selectedDate,
  schedule,
  summary,
  selectedOverride,
  conflictCount,
  onCreate,
  onEdit,
  onDelete,
  onStart,
  onComplete,
  onDelay,
  onSkip,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
  onJump,
}: {
  selectedDate: string;
  schedule: ReturnType<typeof deriveScheduleForDate>;
  summary: ReturnType<typeof getSummaryMetrics>;
  selectedOverride: boolean;
  conflictCount: number;
  onCreate: () => void;
  onEdit: (event: ScheduleEvent) => void;
  onDelete: (eventId: string) => void;
  onStart: (event: ScheduleEvent) => void;
  onComplete: (eventId: string, title: string) => void;
  onDelay: (eventId: string, title: string) => void;
  onSkip: (eventId: string, title: string) => void;
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
  onJump: (view: ViewKey) => void;
}) {
  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">今日时间线</p>
            <h3>按优先级拖拽、顺延与开始学习</h3>
          </div>
          <button type="button" className="solid-button" onClick={onCreate}>
            新增当日事件
          </button>
        </div>

        {schedule.length ? (
          <div className="timeline-list">
            {schedule.map((event) => (
              <article
                key={event.id}
                className={clsx('event-card', event.conflict && 'is-conflict', draggingId === event.id && 'is-dragging')}
                draggable
                onDragStart={() => onDragStart(event.id)}
                onDragEnd={onDragEnd}
                onDragOver={(dragEvent) => dragEvent.preventDefault()}
                onDrop={() => onDrop(event.id)}
              >
                <div className="event-time" style={{ borderColor: event.color }}>
                  <span>{event.startTime}</span>
                  <small>{event.endTime}</small>
                </div>

                <div className="event-content">
                  <div className="event-title-row">
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.subject}</p>
                    </div>
                    <span className={clsx('status-chip', `is-${event.status}`)}>
                      {event.status === 'running'
                        ? '进行中'
                        : event.status === 'completed'
                          ? '已完成'
                          : event.status === 'skipped'
                            ? '已跳过'
                            : '待开始'}
                    </span>
                  </div>

                  <p className="muted">
                    {event.enabled ? '已启用' : '已停用'} · {getReminderDescription(event.reminderPolicy, event.effectiveReminder)}
                    {event.conflict ? ' · 时间冲突' : ''}
                  </p>
                  {event.notes ? <p className="note-text">{event.notes}</p> : null}

                  <div className="event-footer">
                    <div className="event-meta">
                      <span>计划 {formatMinutes(event.plannedMinutes)}</span>
                      <span>实际 {formatMinutes(event.actualMinutes)}</span>
                    </div>

                    <div className="event-actions">
                      {event.status !== 'running' ? (
                        <button type="button" className="ghost-button" onClick={() => onStart(stripOccurrence(event))}>
                          开始学习
                        </button>
                      ) : (
                        <button type="button" className="solid-button" onClick={() => onComplete(event.id, event.title)}>
                          结束学习
                        </button>
                      )}
                      <button type="button" className="ghost-button" onClick={() => onDelay(event.id, event.title)}>
                        顺延 10 分钟
                      </button>
                      <button type="button" className="ghost-button" onClick={() => onSkip(event.id, event.title)}>
                        跳过
                      </button>
                      <button type="button" className="ghost-button" onClick={() => onEdit(stripOccurrence(event))}>
                        编辑
                      </button>
                      <button type="button" className="ghost-button danger" onClick={() => onDelete(event.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="今天还没有安排"
            description="先从周模板复制固定节奏，或者直接给今天添加一条临时学习块。"
            actionLabel="新增当日事件"
            onAction={onCreate}
          />
        )}
      </div>

      <div className="stack-column today-side-column">
        <div className="panel today-overview-panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">今日概览</p>
              <h3>专注状态与风险提示</h3>
            </div>
          </div>

          <ul className="insight-list">
            <li>
              <strong>{summary.nextEvent ? `${summary.nextEvent.startTime} ${summary.nextEvent.title}` : '没有待开始事件'}</strong>
              <span>下一个学习节点</span>
            </li>
            <li>
              <strong>{conflictCount ? `${conflictCount} 处冲突` : '节奏顺畅'}</strong>
              <span>当日时间冲突检测</span>
            </li>
            <li>
              <strong>{selectedOverride ? '已启用日期例外' : '沿用周模板'}</strong>
              <span>{selectedDate} 的安排来源</span>
            </li>
          </ul>

          <div className="divider compact-divider" />
          <div className="today-jump-row">
            <div>
              <p className="eyebrow">快速跳转</p>
              <h3>常用操作</h3>
            </div>
          </div>
          <div className="quick-actions">
            <button type="button" className="ghost-button" onClick={() => onJump('weekly')}>
              去编辑周模板
            </button>
            <button type="button" className="ghost-button" onClick={() => onJump('overrides')}>
              查看日历例外
            </button>
            <button type="button" className="ghost-button" onClick={() => onJump('stats')}>
              查看统计
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function WeeklyPage({
  weekday,
  template,
  copyTargets,
  settingsReminder,
  onSelectWeekday,
  onOpenCreate,
  onEdit,
  onDelete,
  onToggleCopyTarget,
  onCopyTemplate,
}: {
  weekday: Weekday;
  template: ScheduleEvent[];
  copyTargets: Weekday[];
  settingsReminder: ReminderPolicy;
  onSelectWeekday: (weekday: Weekday) => void;
  onOpenCreate: () => void;
  onEdit: (event: ScheduleEvent) => void;
  onDelete: (eventId: string) => void;
  onToggleCopyTarget: (weekday: Weekday) => void;
  onCopyTemplate: () => void;
}) {
  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">周模板</p>
            <h3>固定节奏在这里维护</h3>
          </div>
          <button type="button" className="solid-button" onClick={onOpenCreate}>
            添加模板事件
          </button>
        </div>

        <div className="weekday-tabs" role="tablist" aria-label="选择星期">
          {WEEKDAYS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={clsx('weekday-pill', weekday === item.value && 'is-active')}
              onClick={() => onSelectWeekday(item.value)}
            >
              {item.short}
            </button>
          ))}
        </div>

        {template.length ? (
          <div className="template-list">
            {template.map((event) => (
              <article key={event.id} className="mini-card">
                <div className="mini-card-main">
                  <span className="swatch" style={{ backgroundColor: event.color }} />
                  <div>
                    <strong>{event.title}</strong>
                    <p>
                      {event.subject} · {event.startTime} - {event.endTime}
                    </p>
                  </div>
                </div>

                <div className="mini-card-actions">
                  <span className="muted tiny">{getReminderDescription(event.reminderPolicy, settingsReminder)}</span>
                  <button type="button" className="ghost-button" onClick={() => onEdit(event)}>
                    编辑
                  </button>
                  <button type="button" className="ghost-button danger" onClick={() => onDelete(event.id)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={`${getWeekdayLabel(weekday)} 还没有模板`}
            description="为这个星期几建立稳定节奏，之后每天会自动生成日程。"
            actionLabel="添加模板事件"
            onAction={onOpenCreate}
          />
        )}
      </div>

        <div className="stack-column weekly-side-column">
          <div className="panel weekly-copy-panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">复制模板</p>
              <h3>一键覆盖到其他星期</h3>
            </div>
          </div>

          <div className="copy-grid">
            {WEEKDAYS.filter((item) => item.value !== weekday).map((item) => (
              <button
                key={item.value}
                type="button"
                className={clsx('weekday-pill', copyTargets.includes(item.value) && 'is-active')}
                onClick={() => onToggleCopyTarget(item.value)}
              >
                {item.short}
              </button>
            ))}
          </div>

          <button type="button" className="solid-button wide-button" onClick={onCopyTemplate}>
            复制到已选择的星期
          </button>
        </div>

          <div className="panel weekly-tips-panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">模板使用建议</p>
              <h3>让排程更稳定</h3>
            </div>
          </div>

          <ul className="insight-list">
            <li>
              <strong>按固定主题排布</strong>
              <span>例如上午刷题、晚上复盘，模板更容易长期坚持。</span>
            </li>
            <li>
              <strong>保持时长颗粒度一致</strong>
              <span>50-90 分钟的学习块更适合持续统计。</span>
            </li>
            <li>
              <strong>临时改动放到日历页</strong>
              <span>这样不会破坏周模板的整体节奏。</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function OverridesPage({
  selectedDate,
  schedule,
  hasOverride,
  conflictCount,
  onCreate,
  onEdit,
  onDelete,
  onClear,
}: {
  selectedDate: string;
  schedule: ReturnType<typeof deriveScheduleForDate>;
  hasOverride: boolean;
  conflictCount: number;
  onCreate: () => void;
  onEdit: (event: ScheduleEvent) => void;
  onDelete: (eventId: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">日历例外</p>
            <h3>只改今天，不回写周模板</h3>
          </div>
          <div className="inline-actions">
            <button type="button" className="ghost-button" onClick={onCreate}>
              添加例外事件
            </button>
            <button type="button" className="ghost-button danger" onClick={onClear} disabled={!hasOverride}>
              清空当前例外
            </button>
          </div>
        </div>

        {schedule.length ? (
          <div className="template-list">
            {schedule.map((event) => (
              <article key={event.id} className="mini-card">
                <div className="mini-card-main">
                  <span className="swatch" style={{ backgroundColor: event.color }} />
                  <div>
                    <strong>{event.title}</strong>
                    <p>
                      {event.subject} · {event.startTime} - {event.endTime}
                    </p>
                  </div>
                </div>

                <div className="mini-card-actions">
                  <span className="muted tiny">
                    {event.source === 'template'
                      ? '来自周模板'
                      : event.source === 'override-added'
                        ? '临时新增'
                        : '临时改动'}
                  </span>
                  <button type="button" className="ghost-button" onClick={() => onEdit(stripOccurrence(event))}>
                    编辑
                  </button>
                  <button type="button" className="ghost-button danger" onClick={() => onDelete(event.id)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="这一天暂时没有安排"
            description="可以直接为某个日期加一条临时学习块，或回到周模板批量安排。"
            actionLabel="添加例外事件"
            onAction={onCreate}
          />
        )}
      </div>

        <div className="stack-column stats-side-column">
          <div className="panel csv-export-panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">例外状态</p>
              <h3>当前日期摘要</h3>
            </div>
          </div>

          <ul className="insight-list">
            <li>
              <strong>{hasOverride ? '已生成例外记录' : '当前无例外'}</strong>
              <span>{hasOverride ? '这一天的安排与周模板不完全相同。' : '现在展示的是纯周模板结果。'}</span>
            </li>
            <li>
              <strong>{schedule.filter((item) => item.source === 'override-added').length} 条新增事件</strong>
              <span>{selectedDate} 上的临时补课或顺延安排会出现在这里。</span>
            </li>
            <li>
              <strong>{conflictCount ? `${conflictCount} 处冲突` : '无冲突'}</strong>
              <span>时间重叠会在这里和今日页同步提醒。</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function StatsPage({
  statsSeries,
  range,
  rows,
  totalPlanned,
  totalActual,
  onRangeChange,
  onExport,
}: {
  statsSeries: ReturnType<typeof buildStatsSeries>;
  range: { from: string; to: string };
  rows: ReturnType<typeof buildExportRows>;
  totalPlanned: number;
  totalActual: number;
  onRangeChange: (range: { from: string; to: string }) => void;
  onExport: () => void;
}) {
  const maxValue = Math.max(1, ...statsSeries.map((item) => Math.max(item.plannedMinutes, item.actualMinutes)));

  return (
    <section className="page-grid">
          <div className="panel stats-preview-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">统计</p>
            <h3>最近 7 天的计划与实际</h3>
          </div>
        </div>

        <div className="stats-bars">
          {statsSeries.map((point) => (
            <div key={point.date} className="stat-bar">
              <div className="bar-stack">
                <span className="bar planned" style={{ height: `${(point.plannedMinutes / maxValue) * 100}%` }} />
                <span className="bar actual" style={{ height: `${(point.actualMinutes / maxValue) * 100}%` }} />
              </div>
              <strong>{point.label}</strong>
              <small>
                {formatMinutes(point.actualMinutes)} / {formatMinutes(point.plannedMinutes)}
              </small>
            </div>
          ))}
        </div>

        <div className="summary-grid compact-grid">
          <MetricCard label="导出范围计划" value={formatMinutes(totalPlanned)} />
          <MetricCard label="导出范围实际" value={formatMinutes(totalActual)} />
          <MetricCard label="完成率" value={totalPlanned ? `${Math.round((totalActual / totalPlanned) * 100)}%` : '0%'} />
        </div>
      </div>

      <div className="stack-column">
        <div className="panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">CSV 导出</p>
              <h3>按时间范围生成明细</h3>
            </div>
          </div>

          <div className="range-grid">
            <label className="field">
              <span>开始日期</span>
              <input type="date" value={range.from} onChange={(event) => onRangeChange({ ...range, from: event.target.value })} />
            </label>
            <label className="field">
              <span>结束日期</span>
              <input type="date" value={range.to} onChange={(event) => onRangeChange({ ...range, to: event.target.value })} />
            </label>
          </div>

          <button type="button" className="solid-button wide-button" onClick={onExport}>
            导出 CSV
          </button>
          <p className="muted tiny">导出的字段包含日期、事件、计划时长、实际时长和状态。</p>
        </div>

        <div className="panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">范围预览</p>
              <h3>{rows.length} 行待导出数据</h3>
            </div>
          </div>

          <div className="rows-preview">
            {rows.slice(0, 8).map((row) => (
              <div key={`${row.date}-${row.title}-${row.startTime}`} className="preview-row">
                <span>{row.date}</span>
                <strong>{row.title}</strong>
                <small>
                  {formatMinutes(row.actualMinutes)} / {formatMinutes(row.plannedMinutes)}
                </small>
              </div>
            ))}
            {!rows.length ? <p className="muted">当前范围内还没有可导出的日程记录。</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsPage({
  settings,
  notificationsPaused,
  notificationReady,
  onToggleAutostart,
  onToggleTray,
  onToggleNotifications,
  onStatsModeChange,
  onReminderChange,
  onExportBackup,
  onImportBackup,
}: {
  settings: PersistedState['settings'];
  notificationsPaused: boolean;
  notificationReady: boolean;
  onToggleAutostart: (enabled: boolean) => void;
  onToggleTray: (enabled: boolean) => void;
  onToggleNotifications: (enabled: boolean) => void;
  onStatsModeChange: (mode: StatsDisplayMode) => void;
  onReminderChange: (policy: ReminderPolicy) => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
}) {
  const safeStatsDisplayMode = normalizeStatsDisplayMode(settings.statsDisplayMode);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">设置</p>
            <h3>通知、托盘、备份与统计显示</h3>
          </div>
        </div>

        <div className="setting-list">
          <SettingRow
            title="开机启动"
            description="Windows 登录后自动运行，确保提醒与托盘一直可用。"
            control={<Toggle checked={settings.launchAtStartup} onChange={onToggleAutostart} />}
          />
          <SettingRow
            title="关闭窗口时最小化到托盘"
            description="打开后常驻右下角，右键托盘可快速回到今日视图。"
            control={<Toggle checked={settings.minimizeToTray} onChange={onToggleTray} />}
          />
          <SettingRow
            title="临时暂停通知"
            description="保留所有计划，但先不推送系统提醒。"
            control={<Toggle checked={notificationsPaused} onChange={onToggleNotifications} />}
          />
        </div>

        <div className="divider" />

        <label className="field">
          <span>首页统计展示</span>
          <select
            value={safeStatsDisplayMode}
            onChange={(event) => onStatsModeChange(normalizeStatsDisplayMode(event.target.value) as StatsDisplayMode)}
          >
            <option value="both">计划 + 实际</option>
            <option value="actual">仅实际</option>
            <option value="planned">仅计划</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>

        <div className="divider" />

        <ReminderPolicyEditor
          title="全局默认提醒"
          description="新建事件时默认继承这里，仍可在单个事件里覆盖。"
          policy={settings.defaultReminderPolicy}
          allowInherit={false}
          onChange={onReminderChange}
        />
      </div>

      <div className="stack-column">
        <div className="panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">数据管理</p>
              <h3>本地备份与恢复</h3>
            </div>
          </div>

          <div className="quick-actions">
            <button type="button" className="solid-button" onClick={onExportBackup}>
              导出 JSON 备份
            </button>
            <button type="button" className="ghost-button" onClick={onImportBackup}>
              导入备份
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head compact">
            <div>
              <p className="eyebrow">当前状态</p>
              <h3>桌面行为与提醒状态</h3>
            </div>
          </div>

          <ul className="insight-list">
            <li>
              <strong>{settings.launchAtStartup ? '开机启动已开启' : '开机启动未开启'}</strong>
              <span>适合需要全天保持通知的学习场景。</span>
            </li>
            <li>
              <strong>{notificationReady ? '通知权限已授予' : '通知权限待授权'}</strong>
              <span>若未授权，系统提醒将不会弹出。</span>
            </li>
            <li>
              <strong>{settings.minimizeToTray ? '窗口关闭后留在托盘' : '窗口关闭后直接退出'}</strong>
              <span>可以按自己的桌面习惯切换。</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <article className={clsx('metric-card', accent && 'is-accent')}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <h4>{title}</h4>
      <p>{description}</p>
      <button type="button" className="solid-button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {control}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={clsx('toggle', checked && 'is-active')}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span />
    </button>
  );
}

function ReminderPolicyEditor({
  title,
  description,
  policy,
  allowInherit,
  onChange,
}: {
  title: string;
  description: string;
  policy: ReminderPolicy;
  allowInherit: boolean;
  onChange: (policy: ReminderPolicy) => void;
}) {
  const canEditBeforeMinutes = policy.mode === 'before' || policy.mode === 'combo';
  const canEditCombination = policy.mode === 'combo';

  return (
    <div className="reminder-editor">
      <div className="field">
        <span>{title}</span>
        <small className="muted">{description}</small>
      </div>

      <label className="field">
        <span>提醒方式</span>
        <select value={policy.mode} onChange={(event) => onChange(applyReminderMode(policy, event.target.value as ReminderMode))}>
          {allowInherit ? <option value="inherit">继承全局</option> : null}
          <option value="off">关闭提醒</option>
          <option value="before">开始前提醒</option>
          <option value="start">开始时提醒</option>
          <option value="end">结束后提醒</option>
          <option value="combo">组合提醒</option>
        </select>
      </label>

      {canEditBeforeMinutes ? (
        <label className="field">
          <span>提前分钟</span>
          <input
            type="text"
            value={policy.beforeMinutes.join(', ')}
            onChange={(event) =>
              onChange({
                ...policy,
                beforeMinutes: parseReminderMinutes(event.target.value, policy.beforeMinutes),
              })
            }
            placeholder="例如 30, 10"
          />
        </label>
      ) : null}

      {canEditCombination ? (
        <div className="check-grid">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={policy.notifyAtStart}
              onChange={(event) => onChange({ ...policy, notifyAtStart: event.target.checked })}
            />
            <span>开始时提醒</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={policy.notifyAtEnd}
              onChange={(event) => onChange({ ...policy, notifyAtEnd: event.target.checked })}
            />
            <span>结束后提醒</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function EventEditorPanel({
  title,
  initialEvent,
  globalReminder,
  onCancel,
  onSave,
}: {
  title: string;
  initialEvent: ScheduleEvent;
  globalReminder: ReminderPolicy;
  onCancel: () => void;
  onSave: (event: ScheduleEvent) => void;
}) {
  const [draft, setDraft] = useState<ScheduleEvent>(initialEvent);

  useEffect(() => {
    setDraft(initialEvent);
  }, [initialEvent]);

  const saveDraft = () => {
    if (draft.endTime <= draft.startTime) {
      window.alert('结束时间需要晚于开始时间。');
      return;
    }

    onSave(draft);
  };

  return (
    <div className="editor-modal">
      <div className="editor-backdrop" onClick={onCancel} />
      <section className="editor-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="editor-header">
          <div>
            <p className="eyebrow">事件编辑</p>
            <h3>{title}</h3>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel}>
            关闭
          </button>
        </div>

        <div className="editor-grid">
          <label className="field">
            <span>标题</span>
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="field">
            <span>学科 / 模块</span>
            <input value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} />
          </label>
          <label className="field">
            <span>开始时间</span>
            <input type="time" value={draft.startTime} onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))} />
          </label>
          <label className="field">
            <span>结束时间</span>
            <input type="time" value={draft.endTime} onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))} />
          </label>
          <label className="field">
            <span>配色</span>
            <div className="palette-row">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={clsx('color-dot', draft.color === color && 'is-active')}
                  style={{ backgroundColor: color }}
                  onClick={() => setDraft((current) => ({ ...current, color }))}
                  aria-label={`选择颜色 ${color}`}
                />
              ))}
            </div>
          </label>
          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>启用这个学习块</span>
          </label>
          <label className="field field-span">
            <span>备注</span>
            <textarea
              rows={4}
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              placeholder="可写上学习目标、教材页码或注意事项。"
            />
          </label>
          <div className="field field-span">
            <ReminderPolicyEditor
              title="单事件提醒"
              description={`当前说明：${getReminderDescription(draft.reminderPolicy, globalReminder)}`}
              policy={draft.reminderPolicy}
              allowInherit
              onChange={(policy) => setDraft((current) => ({ ...current, reminderPolicy: policy }))}
            />
          </div>
        </div>

        <div className="editor-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="solid-button" onClick={saveDraft}>
            保存事件
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
