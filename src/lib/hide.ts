export const HIDEABLE: { area: string; items: { id: string; label: string }[] }[] = [
  {
    area: 'Title bar',
    items: [
      { id: 'sidebar-toggle', label: 'Sidebar button' },
      { id: 'new-split', label: 'New tab button' },
      { id: 'usage-chip', label: 'Usage chip' },
      { id: 'header-stats', label: 'Session stats' },
      { id: 'more-menu', label: 'More menu' },
    ],
  },
  {
    area: 'Tab bar',
    items: [
      { id: 'tab-provider-icon', label: 'Agent icon' },
      { id: 'tab-state-dot', label: 'State dot' },
    ],
  },
  {
    area: 'Sidebar',
    items: [
      { id: 'view-switcher', label: 'Sessions and Open switch' },
      { id: 'sidebar-search', label: 'Search box' },
      { id: 'task-box', label: 'Task box' },
      { id: 'notes-pane', label: 'Notes' },
      { id: 'update-banner', label: 'Update notice' },
    ],
  },
  {
    area: 'Session rows',
    items: [
      { id: 'session-age', label: 'Age' },
      { id: 'session-branch', label: 'Branch' },
      { id: 'session-meta', label: 'All details' },
    ],
  },
  {
    area: 'Chat',
    items: [
      { id: 'turn-timing', label: 'Time worked' },
      { id: 'turn-usage', label: 'Usage on hover' },
      { id: 'progress-shimmer', label: 'Progress text' },
      { id: 'task-list', label: 'Task list' },
      { id: 'model-chip', label: 'Model chip' },
      { id: 'effort-chip', label: 'Effort chip' },
      { id: 'jump-latest', label: 'Jump to latest' },
    ],
  },
  {
    area: 'Composer',
    items: [
      { id: 'composer-hints', label: 'Keyboard hints' },
      { id: 'attach-button', label: 'Attach button' },
    ],
  },
];
