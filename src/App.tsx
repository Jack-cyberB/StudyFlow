import { startTransition } from 'react';
import dayjs from 'dayjs';

import { EventEditorPanel, MetricCard, formatMinutes } from './components/shared';
import {
  completeSessionForEvent,
  delayEventForDate,
  skipEventForDate,
  startSessionForEvent,
  toShortDate,
  useStudyFlowApp,
} from './hooks/useStudyFlowApp';
import { getWeekdayLabel, normalizeReminderPolicy, normalizeStatsDisplayMode } from './lib/schedule';
import { OverridesPage } from './pages/OverridesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/StatsPage';
import { TodayPage } from './pages/TodayPage';
import { WeeklyPage } from './pages/WeeklyPage';
import './styles.css';
import type { ViewKey, Weekday } from './types';
import { APP_VERSION } from './version';

const VIEW_ITEMS: Array<{ key: ViewKey; label: string; caption: string }> = [
  { key: 'today', label: '今日', caption: '时间线与专注进度' },
  { key: 'weekly', label: '周模板', caption: '按星期维护固定安排' },
  { key: 'overrides', label: '日期例外', caption: '单日临时调整' },
  { key: 'stats', label: '统计', caption: '学习时长与导出' },
  { key: 'settings', label: '设置', caption: '通知、托盘与备份' },
];

function App() {
  const app = useStudyFlowApp();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <img className="brand-mark" src="/favicon.svg" alt="StudyFlow 图标" />
          <div>
            <p className="eyebrow">{`StudyFlow v${APP_VERSION}`}</p>
            <h1>学习日程桌面板</h1>
            <p className="muted">
              按星期布置固定节奏，再对当天做灵活修订。轻量、离线，适合长期挂在桌面。
            </p>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={app.view === item.key ? 'nav-button is-active' : 'nav-button'}
              onClick={() => app.setView(item.key)}
            >
              <span>{item.label}</span>
              <small>{item.caption}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <p className="eyebrow">今日总学习时长</p>
          <strong className="big-number">{app.displayValue}</strong>
          <p className="muted">
            {app.notificationsPaused
              ? '通知当前已暂停。'
              : app.notificationReady
                ? '系统通知已就绪。'
                : '尚未授予通知权限。'}
          </p>
        </div>

        {app.feedback ? <div className="status-pill">{app.feedback}</div> : null}
      </aside>

      <main className="workspace">
        <header className="hero-panel">
          <div>
            <p className="eyebrow">{toShortDate(app.selectedDate)}</p>
            <h2>把时间块安排成你愿意重复的节奏</h2>
            <p className="muted">今日总览、模板复制、例外修正和学习时长统计都在同一处完成。</p>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => app.setSelectedDate(dayjs(app.selectedDate).subtract(1, 'day').format('YYYY-MM-DD'))}
            >
              前一天
            </button>
            <input
              className="date-input"
              type="date"
              value={app.selectedDate}
              onChange={(event) => {
                const value = event.target.value || app.todayKey;
                startTransition(() => {
                  app.setSelectedDate(value);
                  app.setSelectedWeekday(dayjs(value).day() as Weekday);
                });
              }}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => app.setSelectedDate(dayjs(app.selectedDate).add(1, 'day').format('YYYY-MM-DD'))}
            >
              后一天
            </button>
          </div>
        </header>

        <section className="summary-grid">
          <MetricCard label="计划学习" value={formatMinutes(app.summary.plannedMinutes)} hint={`${app.summary.totalCount} 个事件`} />
          <MetricCard label="实际投入" value={formatMinutes(app.summary.actualMinutes)} hint="已开始和已完成的会话都会计入" />
          <MetricCard
            label="剩余时长"
            value={formatMinutes(app.summary.remainingMinutes)}
            hint={`${app.summary.completedCount} / ${app.summary.totalCount} 已完成`}
            accent
          />
          <MetricCard
            label="下一个节点"
            value={app.summary.nextEvent ? `${app.summary.nextEvent.subject} · ${app.summary.nextEvent.startTime}` : '今天已收尾'}
            hint={app.summary.nextEvent ? app.summary.nextEvent.title : '没有待开始的学习块'}
          />
        </section>

        {app.view === 'today' ? (
          <TodayPage
            selectedDate={app.selectedDate}
            schedule={app.daySchedule}
            summary={app.summary}
            selectedOverride={Boolean(app.selectedOverride)}
            conflictCount={app.activeConflictCount}
            onCreate={() => app.openDateEditor()}
            onEdit={(event) => app.openDateEditor(event)}
            onDelete={app.handleDeleteDateEvent}
            onStart={(event) =>
              app.commitState(
                (current) => startSessionForEvent(current, event, app.selectedDate, dayjs()),
                `${event.title} 已开始计时`,
              )
            }
            onComplete={(eventId, title) =>
              app.commitState(
                (current) => completeSessionForEvent(current, eventId, app.selectedDate, 'completed', dayjs()),
                `${title} 已结束`,
              )
            }
            onDelay={(eventId, title) =>
              app.commitState(
                (current) => delayEventForDate(current, app.selectedDate, eventId, 10),
                `${title} 已顺延 10 分钟`,
              )
            }
            onSkip={(eventId, title) =>
              app.commitState(
                (current) => skipEventForDate(current, eventId, app.selectedDate, dayjs()),
                `${title} 已标记为跳过`,
              )
            }
            draggingId={app.draggingId}
            onDragStart={app.setDraggingId}
            onDragEnd={() => app.setDraggingId(null)}
            onDrop={app.handleReorder}
            onJump={app.setView}
          />
        ) : null}

        {app.view === 'weekly' ? (
          <WeeklyPage
            weekday={app.selectedWeekday}
            template={app.selectedTemplate.events}
            copyTargets={app.copyTargets}
            settingsReminder={app.state.settings.defaultReminderPolicy}
            onSelectWeekday={(weekday) => {
              startTransition(() => {
                app.setSelectedWeekday(weekday);
              });
            }}
            onOpenCreate={() => app.openWeeklyEditor()}
            onEdit={(event) => app.openWeeklyEditor(event)}
            onDelete={app.handleDeleteWeeklyEvent}
            onToggleCopyTarget={(weekday) =>
              app.setCopyTargets((current) =>
                current.includes(weekday)
                  ? current.filter((value) => value !== weekday)
                  : [...current, weekday],
              )
            }
            onCopyTemplate={app.handleCopyTemplate}
          />
        ) : null}

        {app.view === 'overrides' ? (
          <OverridesPage
            selectedDate={app.selectedDate}
            schedule={app.daySchedule}
            hasOverride={Boolean(app.selectedOverride)}
            conflictCount={app.activeConflictCount}
            onCreate={() => app.openDateEditor()}
            onEdit={(event) => app.openDateEditor(event)}
            onDelete={app.handleDeleteDateEvent}
            onClear={() => {
              void app.clearSelectedOverride();
            }}
          />
        ) : null}

        {app.view === 'stats' ? (
          <StatsPage
            statsSeries={app.statsSeries}
            range={app.statsRange}
            rows={app.deferredExportRows}
            totalPlanned={app.statsTotalPlanned}
            totalActual={app.statsTotalActual}
            onRangeChange={app.setStatsRange}
            onExport={() => {
              void app.handleExportCsv();
            }}
          />
        ) : null}

        {app.view === 'settings' ? (
          <SettingsPage
            settings={app.state.settings}
            notificationsPaused={app.notificationsPaused}
            notificationReady={app.notificationReady}
            onToggleAutostart={(enabled) => {
              void app.handleAutostartToggle(enabled);
            }}
            onToggleTray={(enabled) =>
              app.commitState(
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
            onToggleNotifications={app.setNotificationsPaused}
            onStatsModeChange={(mode) =>
              app.commitState(
                (current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    statsDisplayMode: normalizeStatsDisplayMode(mode),
                  },
                }),
                '统计显示方式已更新',
              )
            }
            onReminderChange={(policy) =>
              app.commitState(
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
              void app.handleExportBackup();
            }}
            onImportBackup={() => {
              void app.handleImportBackup();
            }}
          />
        ) : null}
      </main>

      {app.editor ? (
        <EventEditorPanel
          key={`${app.editor.scope}-${app.editor.scope === 'weekly' ? app.editor.weekday : app.editor.date}-${app.editor.event.id}`}
          title={app.editor.scope === 'weekly' ? `${getWeekdayLabel(app.editor.weekday)} 模板事件` : `${app.editor.date} 临时事件`}
          initialEvent={app.editor.event}
          globalReminder={app.state.settings.defaultReminderPolicy}
          onCancel={() => app.setEditor(null)}
          onSave={app.handleSaveEditor}
        />
      ) : null}
    </div>
  );
}

export default App;
