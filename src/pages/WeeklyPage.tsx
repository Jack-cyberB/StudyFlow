import clsx from 'clsx';

import { EmptyState } from '../components/shared';
import { getReminderDescription, getWeekdayLabel, WEEKDAYS } from '../lib/schedule';
import type { ReminderPolicy, ScheduleEvent, Weekday } from '../types';

export function WeeklyPage({
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
              <span>比如上午刷题、晚上复盘，模板更容易长期坚持。</span>
            </li>
            <li>
              <strong>保持时长颗粒度一致</strong>
              <span>50-90 分钟的学习块更适合持续统计。</span>
            </li>
            <li>
              <strong>临时改动放到日期页</strong>
              <span>这样不会破坏周模板的整体节奏。</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
