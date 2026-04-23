import clsx from 'clsx';

import { EmptyState, formatMinutes } from '../components/shared';
import { getReminderDescription, stripOccurrence } from '../lib/schedule';
import type { DaySchedule, Summary } from '../hooks/useStudyFlowApp';
import type { ScheduleEvent, ViewKey } from '../types';

export function TodayPage({
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
  schedule: DaySchedule;
  summary: Summary;
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
              查看日期例外
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
