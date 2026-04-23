import { type ReactNode, useEffect, useState } from 'react';
import clsx from 'clsx';

import { COLOR_SWATCHES, formatMinutes, getReminderDescription, normalizeReminderPolicy } from '../lib/schedule';
import type { ReminderMode, ReminderPolicy, ScheduleEvent } from '../types';

export function MetricCard({
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

export function EmptyState({
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

export function SettingRow({
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

export function Toggle({
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

  if (mode === 'off' || mode === 'before') {
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

export function ReminderPolicyEditor({
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

export function EventEditorPanel({
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
              placeholder="可以写上学习目标、教材页码或注意事项。"
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

export { formatMinutes };
