import { MetricCard, formatMinutes } from '../components/shared';
import type { ExportRows, StatsRange, StatsSeries } from '../hooks/useStudyFlowApp';

export function StatsPage({
  statsSeries,
  range,
  rows,
  totalPlanned,
  totalActual,
  onRangeChange,
  onExport,
}: {
  statsSeries: StatsSeries;
  range: StatsRange;
  rows: ExportRows;
  totalPlanned: number;
  totalActual: number;
  onRangeChange: (range: StatsRange) => void;
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
