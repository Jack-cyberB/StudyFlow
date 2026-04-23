import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createEvent, DEFAULT_REMINDER_POLICY } from '../lib/schedule';
import { WeeklyPage } from './WeeklyPage';

describe('WeeklyPage', () => {
  it('renders all weekday tabs and forwards clicks for future weekdays', async () => {
    const user = userEvent.setup();
    const onSelectWeekday = vi.fn();

    render(
      <WeeklyPage
        weekday={4}
        template={[
          createEvent({
            title: '周四复习',
            subject: '英语',
            startTime: '19:00',
            endTime: '20:00',
          }),
        ]}
        copyTargets={[]}
        settingsReminder={DEFAULT_REMINDER_POLICY}
        onSelectWeekday={onSelectWeekday}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleCopyTarget={vi.fn()}
        onCopyTemplate={vi.fn()}
      />,
    );

    const tabs = screen.getByRole('tablist', { name: '选择星期' });
    const weekdayTabs = within(tabs).getAllByRole('tab');

    expect(weekdayTabs).toHaveLength(7);

    await user.click(screen.getByRole('tab', { name: '查看周五模板' }));

    expect(onSelectWeekday).toHaveBeenCalledWith(5);
  });
});
