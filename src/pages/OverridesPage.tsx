import { EmptyState } from '../components/shared';
import type { DaySchedule } from '../hooks/useStudyFlowApp';
import { stripOccurrence } from '../lib/schedule';
import type { ScheduleEvent } from '../types';

export function OverridesPage({
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
  schedule: DaySchedule;
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
            <p className="eyebrow">日期例外</p>
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
                        : '临时修改'}
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
            description="可以直接为某一天添加一条临时学习块，或者回到周模板批量安排。"
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
              <strong>{hasOverride ? '已生成例外记录' : '当前没有例外'}</strong>
              <span>{hasOverride ? '这一天的安排与周模板不完全相同。' : '现在展示的是纯周模板结果。'}</span>
            </li>
            <li>
              <strong>{schedule.filter((item) => item.source === 'override-added').length} 条新增事件</strong>
              <span>{selectedDate} 上的临时补课或顺延安排会显示在这里。</span>
            </li>
            <li>
              <strong>{conflictCount ? `${conflictCount} 处冲突` : '没有冲突'}</strong>
              <span>时间重叠会在这里和今日页同步提示。</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
