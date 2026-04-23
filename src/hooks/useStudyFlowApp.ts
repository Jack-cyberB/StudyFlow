import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import dayjs from 'dayjs';

import {
  applyScheduleToDate,
  buildExportRows,
  buildNotificationPlan,
  buildStatsSeries,
  COLOR_SWATCHES,
  completeSessionForEvent,
  copyTemplateToWeekdays,
  createEvent,
  DATE_FORMAT,
  delayEventForDate,
  deriveScheduleForDate,
  EMPTY_STATE,
  getDisplayValue,
  getOverrideForDate,
  getSummaryMetrics,
  getTemplateForWeekday,
  getWeekdayLabel,
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
} from '../lib/schedule';
import {
  confirmOverrideReset,
  deliverNotification,
  ensureNotificationPermission,
  exportBackupFile,
  exportCsvFile,
  getNotificationPermission,
  importBackupFile,
  listenTrayActions,
  loadPersistedState,
  persistPlatformState,
  setAutostartEnabled,
  showPlatformError,
} from '../services/platform';
import type { PersistedState, ScheduleEvent, ViewKey, Weekday } from '../types';

export type EditorState =
  | { scope: 'weekly'; weekday: Weekday; event: ScheduleEvent }
  | { scope: 'date'; date: string; event: ScheduleEvent };

export type DaySchedule = ReturnType<typeof deriveScheduleForDate>;
export type Summary = ReturnType<typeof getSummaryMetrics>;
export type StatsSeries = ReturnType<typeof buildStatsSeries>;
export type ExportRows = ReturnType<typeof buildExportRows>;
export type StatsRange = { from: string; to: string };

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

export const toShortDate = (date: string) => {
  const weekday = WEEKDAYS[dayjs(date).day()];
  return `${dayjs(date).format('M 月 D 日')} · ${weekday.short}`;
};

export function useStudyFlowApp() {
  const [state, setState] = useState<PersistedState>(EMPTY_STATE);
  const [view, setView] = useState<ViewKey>('today');
  const [selectedDate, setSelectedDate] = useState(getDefaultDate);
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday>(dayjs().day() as Weekday);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [copyTargets, setCopyTargets] = useState<Weekday[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('正在加载本地日程...');
  const [notificationsPaused, setNotificationsPaused] = useState(false);
  const [notificationReady, setNotificationReady] = useState(false);
  const [now, setNow] = useState(dayjs());
  const [statsRange, setStatsRange] = useState<StatsRange>({
    from: dayjs().subtract(6, 'day').format(DATE_FORMAT),
    to: dayjs().format(DATE_FORMAT),
  });
  const stateRef = useRef(state);
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const notificationTimeoutsRef = useRef<number[]>([]);
  const deliveredNotificationsRef = useRef<Set<number>>(new Set());

  const todayKey = now.format(DATE_FORMAT);
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
  const statsTotalPlanned = deferredExportRows.reduce((total, row) => total + row.plannedMinutes, 0);
  const statsTotalActual = deferredExportRows.reduce((total, row) => total + row.actualMinutes, 0);
  const displayValue = getDisplayValue(getSummaryMetrics(state, todayKey, now), state.settings.statsDisplayMode);

  const showFeedback = useEffectEvent((value: string) => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(value);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 3200);
  });

  const showError = useEffectEvent(async (title: string, description: string) => {
    await showPlatformError(title, description);
  });

  const persistState = useEffectEvent(async (payload: PersistedState) => {
    try {
      await persistPlatformState(payload);
    } catch (error) {
      await showError('保存失败', `未能写入本地数据：${String(error)}`);
    }
  });

  const commitState = (updater: (current: PersistedState) => PersistedState, notice?: string) => {
    let nextState: PersistedState | null = null;

    setState((current) => {
      nextState = normalizeState(updater(current));
      stateRef.current = nextState;
      return nextState;
    });

    if (nextState) {
      void persistState(nextState);
    }

    if (notice) {
      showFeedback(notice);
    }
  };

  const loadApp = useEffectEvent(async () => {
    try {
      const initial = await loadPersistedState();
      stateRef.current = initial;
      setState(initial);
      setSelectedWeekday(dayjs().day() as Weekday);
      setLoading(false);
      setFeedback('StudyFlow 已就绪');
      setNotificationReady(await getNotificationPermission());
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
    let dispose = () => {};

    const attach = async () => {
      dispose = await listenTrayActions({
        onOpenToday: () => {
          startTransition(() => {
            setView('today');
            setSelectedDate(getDefaultDate());
          });
          showFeedback('已从托盘打开今日视图');
        },
        onToggleNotifications: () => {
          setNotificationsPaused((current) => {
            const next = !current;
            showFeedback(next ? '提醒已暂停' : '提醒已恢复');
            return next;
          });
        },
      });
    };

    void attach();
    return () => dispose();
  }, [showFeedback]);

  const syncNotifications = useEffectEvent(async () => {
    if (loading) {
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
      setNotificationReady(granted);
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
          deliverNotification(item);
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
      const filePath = await exportBackupFile(stateRef.current);
      if (!filePath) {
        return;
      }

      showFeedback(`备份已导出到 ${filePath}`);
    } catch (error) {
      await showError('导出失败', `无法写出备份文件：${String(error)}`);
    }
  };

  const handleImportBackup = async () => {
    try {
      const imported = await importBackupFile();
      if (!imported) {
        return;
      }

      stateRef.current = imported;
      setState(imported);
      await setAutostartEnabled(imported.settings.launchAtStartup);
      showFeedback('备份已恢复');
    } catch (error) {
      await showError('导入失败', `备份文件无法读取：${String(error)}`);
    }
  };

  const handleExportCsv = async () => {
    try {
      const filePath = await exportCsvFile(deferredExportRows, statsRange);
      if (!filePath) {
        return;
      }

      showFeedback(`CSV 已导出到 ${filePath}`);
    } catch (error) {
      await showError('导出失败', `无法生成 CSV：${String(error)}`);
    }
  };

  const clearSelectedOverride = async () => {
    const ok = await confirmOverrideReset();
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
      await setAutostartEnabled(enabled);
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

  return {
    state,
    view,
    setView,
    selectedDate,
    setSelectedDate,
    selectedWeekday,
    setSelectedWeekday,
    editor,
    setEditor,
    copyTargets,
    setCopyTargets,
    draggingId,
    setDraggingId,
    feedback,
    notificationsPaused,
    setNotificationsPaused,
    notificationReady,
    statsRange,
    setStatsRange,
    todayKey,
    selectedTemplate,
    daySchedule,
    selectedOverride,
    summary,
    statsSeries,
    deferredExportRows,
    activeConflictCount,
    statsTotalPlanned,
    statsTotalActual,
    displayValue,
    commitState,
    openWeeklyEditor,
    openDateEditor,
    handleSaveEditor,
    handleDeleteWeeklyEvent,
    handleDeleteDateEvent,
    handleReorder,
    handleCopyTemplate,
    handleExportBackup,
    handleImportBackup,
    handleExportCsv,
    clearSelectedOverride,
    handleAutostartToggle,
  };
}

export { completeSessionForEvent, delayEventForDate, startSessionForEvent, skipEventForDate };
