import { ReminderPolicyEditor, SettingRow, Toggle } from '../components/shared';
import { normalizeStatsDisplayMode } from '../lib/schedule';
import type { PersistedState, ReminderPolicy, StatsDisplayMode } from '../types';

export function SettingsPage({
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
          <span>首页统计显示</span>
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
              <strong>{notificationReady ? '通知权限已授予' : '通知权限待授予'}</strong>
              <span>若未授权，系统提醒将不会弹出。</span>
            </li>
            <li>
              <strong>{settings.minimizeToTray ? '关闭后留在托盘' : '关闭后直接退出'}</strong>
              <span>可以按自己的桌面习惯切换。</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
