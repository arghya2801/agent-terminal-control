<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import ProviderPicker from './lib/ProviderPicker.svelte';
  import { providerName, sessionKey } from './lib/agents';
  import InlineRename from './lib/InlineRename.svelte';
  import ProviderIcon from './lib/ProviderIcon.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import DebugOverlay from './debug/DebugOverlay.svelte';
  import Sidebar from './sidebar/Sidebar.svelte';
  import FindBar from './terminal/FindBar.svelte';
  import SettingsPanel from './settings/SettingsPanel.svelte';
  import UsagePanel from './usage/UsagePanel.svelte';
  import ShortcutsPanel from './settings/ShortcutsPanel.svelte';
  import ConfirmDialog from './lib/ConfirmDialog.svelte';
  import Icon from './lib/Icon.svelte';
  import Tooltip from './lib/Tooltip.svelte';
  import UsageChip from './tabs/UsageChip.svelte';
  import { loadClaudeLimits } from './lib/limits.svelte';
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
  } from './lib/desktop';
  import {
    adjustZoom,
    appState,
    currentZoom,
    enterMs,
    initStores,
    refreshMs,
    saveSettings,
    sidebarOpen,
    toggleSidebar,
    setSidebarView,
    sidebarView,
  } from './lib/stores.svelte';
  import {
    bindSessions,
    closeTab,
    cycleTab,
    displayTitle,
    focusActiveTerminal,
    getActiveKey,
    getTab,
    busyWith,
    listTabs,
    mount as mountTerminals,
    onAttention,
    onChange,
    onChord,
    openTab,
    refit,
    refitNow,
    tabAt,
    hasSelection,
    copySelection,
    pasteInto,
    selectAllIn,
    clearTerminal,
    renameTab,
    activate,
    focusOtherPane,
    isSplit,
    toggleMosaic,
    getSplitRatio,
    setSplitRatio,
    splitWith,
    unsplit,
    type AttentionReason,
    type Tab,
  } from './terminal/manager';
  import { actionList, chordFor, matchChord, type Action } from './lib/keymap';
  import CommandPalette, { type Command } from './lib/CommandPalette.svelte';
  import ContextMenu, { type MenuItem } from './sidebar/ContextMenu.svelte';
  import type { IconName } from './lib/Icon.svelte';
  import { relativeTime } from './lib/format';
  import { parseSavedTabs, type SavedTab } from './lib/restore';
  import { agentCommand, openDevtools, pickFolder, scratchDir } from './lib/ipc';
  import { projectKey } from './lib/paths';
  import { resolveSessions, type TabRef } from './lib/sessions';
  import { zoomLabel } from './lib/zoom';
  import type { AgentProvider, Project, SessionMeta, TabKey, TabSummary } from './types';
  import { markTitle, tabMark, type SessionMark } from './lib/format';
  import { nextWaiting, stateWord } from './lib/triage';

  let wrapper: HTMLDivElement;
  let tabs = $state<TabSummary[]>([]);
  let activeKey = $state<TabKey | null>(null);
  let openProjectKeys = $state<Set<string>>(new Set());
  let tabSessions = $state<(TabRef & { activity: SessionMark; exited: boolean })[]>([]);

  /** Which sidebar session each tab is showing. See `resolveSessions` for how. */
  const tabToSession = $derived(resolveSessions(tabSessions, appState.index.projects));

  /** Which sessions have a tab, and what Claude is doing in each. */
  const sessionMarks = $derived.by(() => {
    const marks = new Map<string, SessionMark>();
    for (const t of tabSessions) {
      if (t.exited) continue;
      const id = tabToSession.get(t.key);
      if (id) marks.set(id, t.activity);
    }
    return marks;
  });

  /** The sidebar row to highlight: the session the focused tab is showing. */
  const activeSessionId = $derived(activeKey ? (tabToSession.get(activeKey) ?? null) : null);

  /** The session a tab is showing, for deciding how to restore it. */
  function sessionIdOf(t: Tab): string | null {
    const key = t.boundSession ?? tabToSession.get(t.key);
    return key ? key.slice(key.indexOf(':') + 1) : null;
  }

  // --- restore tabs on launch
  const TABS_KEY = import.meta.env.VITE_ATC_PLAYGROUND === '1' ? 'atc.playground.tabs' : 'atc.tabs';
  /** Until startup has reopened the saved tabs, saving would overwrite them. */
  let restoring = $state(true);

  /** Tabs started as chats, so saving and restoring keeps their chat arguments. */
  const chatTabs = new Set<TabKey>();

  let savedTabs = '';
  function saveTabs(all: Tab[]) {
    if (restoring) return;
    // Exited tabs are kept: they are still in the tab bar, and on quit every shell exits
    // just before the window goes, which must not wipe what gets restored.
    const tabs = all.map((t): SavedTab => {
      const common = { projectKey: t.projectKey, customTitle: t.customTitle, ...(chatTabs.has(t.key) ? { chat: true as const } : {}) };
      const sessionId = sessionIdOf(t);
      if (sessionId && t.cwd) return { kind: 'session', provider: t.provider ?? 'claude', sessionId, cwd: t.cwd, ...common };
      if (t.provider && t.cwd) return { kind: 'agent', provider: t.provider, cwd: t.cwd, ...common };
      return { kind: 'shell', cwd: t.cwd, project: t.key.startsWith('project:'), projectKey: t.projectKey, customTitle: t.customTitle };
    });
    try {
      const active = all.findIndex((t) => t.key === activeKey);
      const text = JSON.stringify({ tabs, active });
      // Every tab event lands here (titles change constantly); only real changes write.
      if (text === savedTabs) return;
      localStorage.setItem(TABS_KEY, text);
      savedTabs = text;
    } catch {
      // Storage unavailable: tabs just are not restored next time.
    }
  }

  /** Reopen last session's tabs. False when there was nothing to reopen. */
  async function restoreTabs(): Promise<boolean> {
    if (appState.settings?.ui.restoreTabs === false) return false;
    let saved;
    try {
      saved = parseSavedTabs(localStorage.getItem(TABS_KEY));
    } catch {
      saved = null;
    }
    if (!saved) return false;

    const keys: TabKey[] = [];
    for (const t of saved.tabs) {
      let key: TabKey;
      if (t.kind === 'session') {
        key = `session:${t.provider}:${t.sessionId}`;
        const label = appState.index.projects
          .flatMap((p) => p.sessions)
          .find((s) => s.id === t.sessionId && s.provider === t.provider)?.label;
        if (t.chat) chatTabs.add(key);
        const command = await agentCommand(t.provider, t.sessionId, t.chat);
        await guard(() =>
          openTab(key, label ?? providerName(t.provider), { cwd: t.cwd, initialCommand: command }, t.projectKey, t.provider),
        );
      } else if (t.kind === 'agent') {
        counter += 1;
        key = t.chat ? `agent:${t.provider}:chat-${counter}` : `agent:${t.provider}:${counter}`;
        if (t.chat) chatTabs.add(key);
        await guard(async () => openTab(key, providerName(t.provider), { cwd: t.cwd, initialCommand: await agentCommand(t.provider, null, t.chat) }, t.projectKey, t.provider, knownSessions()));
      } else if (t.kind === 'shell' && t.project && t.projectKey) {
        key = `project:${t.projectKey}`;
        const name = appState.index.projects.find((p) => p.key === t.projectKey)?.name ?? 'pwsh';
        await guard(() => openTab(key, name, { cwd: t.cwd }, t.projectKey));
      } else {
        // Fresh plain keys, so the counter cannot collide with a restored tab.
        counter += 1;
        key = `plain:${counter}`;
        await guard(() => openTab(key, `pwsh ${counter}`, { cwd: t.cwd }, t.projectKey));
      }
      if (t.customTitle) renameTab(key, t.customTitle);
      keys.push(key);
    }
    const focus = keys[saved.active];
    if (focus) activate(focus);
    return listTabs().length > 0;
  }
  let showDebug = $state(false);
  let showFind = $state(false);
  type PageName = 'settings' | 'usage' | 'shortcuts';
  let page = $state<PageName | null>(null);
  /** Settings and shortcuts open over the whole app, which waits behind them. */
  const popup = $derived(page === 'settings' || page === 'shortcuts');
  let renamingTab = $state<TabKey | null>(null);
  /** A busy tab waiting on the close confirmation. */
  let closing = $state<{ key: TabKey; title: string; what: string } | null>(null);

  function togglePage(p: PageName) {
    page = page === p ? null : p;
  }
  let error = $state<string | null>(null);
  let counter = 0;

  const open = $derived(sidebarOpen());
  // Same limits as the settings page.
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 800;
  const SIDEBAR_DEFAULT = 260;
  /** Svelte's `cubicOut`, which the drawer uses, so drawer and terminal move as one. */
  const DRAWER_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
  /** Live width while the edge is being dragged; saved once, when the drag ends. */
  let dragWidth = $state<number | null>(null);
  const width = $derived(dragWidth ?? appState.settings?.ui.sidebarWidth ?? SIDEBAR_DEFAULT);

  function saveSidebarWidth(w: number) {
    if (!appState.settings || appState.settings.ui.sidebarWidth === w) return;
    void saveSettings({ ...appState.settings, ui: { ...appState.settings.ui, sidebarWidth: w } });
  }

  function startResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => {
      const w = Math.round(startWidth + ev.clientX - startX);
      dragWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (dragWidth !== null) saveSidebarWidth(dragWidth);
      dragWidth = null;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  let split = $state(false);
  let splitRatio = $state(0.5);

  function dragSplit(e: PointerEvent) {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    const box = wrapper.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setSplitRatio((m.clientX - box.left) / box.width);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
  }

  function sync() {
    split = isSplit();
    splitRatio = getSplitRatio();
    const all = listTabs();
    tabs = all.map((t) => ({
      key: t.key,
      provider: t.provider,
      title: displayTitle(t),
      exited: t.exited,
      attention: t.attention,
      activity: t.activity,
      projectKey: t.projectKey,
      since: t.markSince,
    }));
    const nextActive = getActiveKey();
    // Picking a tab means the user wants the terminal, not the page covering it.
    if (nextActive !== activeKey) page = null;
    activeKey = nextActive;
    openProjectKeys = new Set(all.flatMap((t) => (t.projectKey ? [t.projectKey] : [])));
    // Before saveTabs: it asks which session each tab is showing, and that answer is
    // derived from this list. Saving first would persist the previous tick's answer.
    tabSessions = all.map((t) => ({
      key: t.key,
      provider: t.provider,
      projectKey: t.projectKey,
      cwd: t.cwd,
      claudeName: t.claudeName,
      boundSession: t.boundSession,
      existingSessions: t.existingSessions,
      startedAt: t.startedAt,
      activity: t.attention ? 'attention' : (t.activity ?? 'open'),
      exited: t.exited,
    }));
    saveTabs(all);
  }

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn();
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  /** Split beside the next tab, opening a shell when there is no other (#21). */
  async function toggleSplit() {
    if (isSplit()) return unsplit();
    const current = activeKey;
    let other = tabs.find((t) => t.key !== current)?.key ?? null;
    if (!other) {
      // A new tab becomes the active one.
      await newTab();
      other = getActiveKey();
    }
    if (current && other && other !== current) {
      activate(current);
      splitWith(other);
    }
  }

  function newTab() {
    const p = appState.settings?.ui.newTabIn === 'project' ? activeProject() : undefined;
    if (p) return newShellIn(p);
    counter += 1;
    return guard(() => openTab(`plain:${counter}`, `pwsh ${counter}`, { cwd: null }));
  }

  function openProject(p: Project) {
    if (!p.path) return;
    return guard(() => openTab(`project:${p.key}`, p.name, { cwd: p.path }, p.key));
  }

  /** Always a fresh tab, unlike openProject which focuses an existing one. */
  function newShellIn(p: Project) {
    if (!p.path) return;
    counter += 1;
    return guard(() => openTab(`plain:${counter}`, p.name, { cwd: p.path }, p.key));
  }

  /**
   * Start an agent on `task` without leaving the current tab. The new tab has to be shown
   * for a frame to spawn at its real size, then focus goes back.
   */
  function dispatch(p: Project, provider: AgentProvider, task: string) {
    if (!p.path) return;
    counter += 1;
    const key: TabKey = `agent:${provider}:${counter}`;
    const back = activeKey;
    // Typed into PowerShell: single quotes take everything literally but a doubled quote.
    const quoted = `'${task.replaceAll("'", "''")}'`;
    return guard(async () => {
      await openTab(key, task.slice(0, 40), { cwd: p.path, initialCommand: `${await agentCommand(provider)} ${quoted}` }, p.key, provider, knownSessions());
      if (back) activate(back);
    });
  }

  function knownSessions(): string[] { return appState.index.projects.flatMap(p => p.sessions.map(sessionKey)); }

  /** With `chat`, the agent starts with the chat arguments and cannot change anything. */
  function newAgentIn(p: Project, provider: AgentProvider, chat = false) {
    if (!p.path) return;
    counter += 1;
    const key: TabKey = chat ? `agent:${provider}:chat-${counter}` : `agent:${provider}:${counter}`;
    if (chat) chatTabs.add(key);
    const existing = knownSessions();
    return guard(async () => openTab(key, p.name, { cwd: p.path, initialCommand: await agentCommand(provider, null, chat) }, p.key, provider, existing));
  }

  /** Ask an agent, or with `chat` chat with one, in the scratch directory. */
  function inScratch(provider: AgentProvider, chat = false) {
    void guard(async () => {
      const cwd = await scratchDir();
      const name = chat ? `${providerName(provider)} chat` : `Ask ${providerName(provider)}`;
      await newAgentIn({ key: projectKey(cwd), path: cwd, name, pinned: false, exists: true, lastActiveMs: 0, sessions: [] }, provider, chat);
    });
  }

  /** No project: the scratch directory. */
  let picker = $state<{ project: Project | null } | null>(null);
  function finishPicker(provider?: AgentProvider) {
    const target = picker;
    picker = null;
    if (!provider || !target) { void tick().then(focusActiveTerminal); return; }
    if (target.project) void newAgentIn(target.project, provider);
    else inScratch(provider);
  }

  /** A folder that is not a project yet: pick it, then pick the agent to start there. */
  async function openFolder() {
    const path = await pickFolder().catch((e) => void (error = String(e)));
    if (!path) return;
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    picker = { project: { key: projectKey(path), path, name, pinned: false, exists: true, lastActiveMs: 0, sessions: [] } };
  }

  // --- right-click: ATC's own menu, never the WebView's
  let contextMenu = $state<{ x: number; y: number; items: MenuItem[]; dropdown?: boolean } | null>(null);

  function terminalItems(key: TabKey): MenuItem[] {
    const selected = hasSelection(key);
    return [
      { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', disabled: !selected, run: () => void copySelection(key) },
      { label: 'Paste', icon: 'paste', hint: 'Ctrl+V', run: () => void pasteInto(key) },
      { label: 'Select all', run: () => selectAllIn(key) },
      { label: 'Clear terminal', run: () => clearTerminal(key) },
      { label: 'Find…', icon: 'search', sep: true, hint: chordFor('find'), run: () => runAction('find') },
      { label: isSplit() ? 'Back to one pane' : 'Split', icon: 'split', hint: chordFor('toggleSplit'), run: () => void toggleSplit() },
      { label: 'Rename tab…', icon: 'pencil', hint: chordFor('renameTab'), run: () => (renamingTab = key) },
      { label: 'Close tab', icon: 'close', sep: true, hint: chordFor('closeTab'), run: () => void requestClose(key) },
    ];
  }

  /** Cut, copy and paste for text boxes and the notes pad, through the browser's own commands. */
  function editItems(field: HTMLElement): MenuItem[] {
    const input = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null;
    const selected = input ? input.selectionStart !== input.selectionEnd : !document.getSelection()?.isCollapsed;
    const exec = (command: string) => () => {
      field.focus();
      document.execCommand(command);
    };
    return [
      { label: 'Cut', hint: 'Ctrl+X', disabled: !selected, run: exec('cut') },
      { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', disabled: !selected, run: exec('copy') },
      {
        label: 'Paste',
        icon: 'paste',
        hint: 'Ctrl+V',
        run: () =>
          void navigator.clipboard.readText().then((text) => {
            field.focus();
            document.execCommand('insertText', false, text);
          }),
      },
      { label: 'Select all', hint: 'Ctrl+A', sep: true, run: () => (input ? (input.focus(), input.select()) : exec('selectAll')()) },
    ];
  }

  /** Runs after any component's own menu, which marks the event handled. */
  function onContextMenu(e: MouseEvent) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    const key = tabAt(target);
    if (key) {
      activate(key);
      contextMenu = { x: e.clientX, y: e.clientY, items: terminalItems(key) };
      return;
    }
    const field = target.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
    if (field) contextMenu = { x: e.clientX, y: e.clientY, items: editItems(field) };
  }

  function openUsage() {
    page = 'usage';
  }
  function closeUsage() {
    if (page === 'usage') page = null;
  }

  /** What the pane header says about the focused tab: project, branch, state and for how long. */
  let now = $state(Date.now());
  const shown = $derived(tabs.find((t) => t.key === activeKey) ?? null);
  const shownFacts = $derived.by(() => {
    if (!shown) return '';
    const sessionId = tabToSession.get(shown.key);
    const branch = appState.index.projects.flatMap((p) => p.sessions).find((s) => sessionKey(s) === sessionId)?.gitBranch;
    const state = stateWord(tabMark(shown));
    return [
      appState.index.projects.find((p) => p.key === shown.projectKey)?.name,
      branch !== 'main' && branch,
      state && `${state} ${relativeTime(shown.since, now)}`,
    ].filter(Boolean).join(', ');
  });

  function startRename(key: TabKey) {
    activate(key);
    page = null;
    renamingTab = key;
  }
  function finishRename(name?: string) {
    if (renamingTab && name !== undefined) renameTab(renamingTab, name);
    renamingTab = null;
    // After the Enter's keypress, or the terminal gets it and the agent reads an empty answer.
    setTimeout(focusActiveTerminal);
  }

  /** A menu dropped from a header button. */
  function menuAt(e: MouseEvent, items: MenuItem[]) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    contextMenu = { x: r.right, y: r.bottom + 4, items, dropdown: true };
  }

  /** In the focused tab's project when it has one, else the scratch directory. */
  function newMenu(e: MouseEvent) {
    const p = activeProject();
    // Only a real project is named; the scratch and chats folders are not places people pick.
    const where = p && !p.kind ? ` in ${p.name}` : '';
    const agent = (provider: AgentProvider): MenuItem => ({
      label: `${providerName(provider)}${where}`,
      icon: 'agent',
      run: () => (p ? void newAgentIn(p, provider) : askAgent(provider)),
    });
    menuAt(e, [
      { label: `Shell${where}`, icon: 'terminal', run: () => void (p ? newShellIn(p) : newTab()) },
      agent('claude'),
      agent('codex'),
    ]);
  }

  function moreMenu(e: MouseEvent) {
    menuAt(e, [
      { label: 'Usage and spend', icon: 'usage', hint: chordFor('openUsage'), run: openUsage },
      { label: 'Settings', icon: 'settings', hint: chordFor('openSettings'), run: () => (page = 'settings') },
      { label: 'Keyboard shortcuts', icon: 'keyboard', hint: chordFor('showShortcuts'), run: () => (page = 'shortcuts') },
      { label: 'Command palette', icon: 'search', sep: true, hint: chordFor('palette'), run: () => (paletteOpen = true) },
      ...(currentZoom() !== 1 ? [{ label: `Reset zoom (${zoomLabel(currentZoom())})`, hint: chordFor('zoomReset'), run: () => void adjustZoom(0) }] : []),
    ]);
  }

  // --- command palette
  let paletteOpen = $state(false);
  const ACTION_ICONS: Partial<Record<Action, IconName>> = {
    newTab: 'plus', closeTab: 'close', renameTab: 'pencil', toggleSplit: 'split', toggleSidebar: 'sidebar',
    openSettings: 'settings', openUsage: 'usage', showShortcuts: 'keyboard', find: 'search', focusSearch: 'search',
    askAgent: 'agent', openAgentHere: 'agent', openShellHere: 'terminal', toggleDebug: 'pulse',
  };

  /** Built when the palette opens, from what is open and indexed at that moment. */
  function paletteCommands(): { all: Command[]; initial: Command[] } {
    const projectName = (key: string | null) => appState.index.projects.find((p) => p.key === key)?.name;
    const tabCmds: Command[] = tabs.map((t) => ({
      id: `t:${t.key}`,
      label: t.title,
      detail: ['Open tab', projectName(t.projectKey)].filter(Boolean).join(', '),
      icon: t.provider ? 'agent' : 'terminal',
      run: () => activate(t.key),
    }));
    const extras: Command[] = [
      { id: 'x:folder', label: 'Open a folder…', detail: 'Pick a folder, then Claude or Codex', icon: 'folder', run: () => void openFolder() },
      { id: 'x:claude', label: 'Ask Claude', detail: 'In the scratch directory', icon: 'agent', run: () => askAgent('claude') },
      { id: 'x:codex', label: 'Ask Codex', detail: 'In the scratch directory', icon: 'agent', run: () => askAgent('codex') },
      { id: 'x:chat-claude', label: 'Chat with Claude', detail: 'No tools or MCP servers: it cannot run commands or touch files', icon: 'agent', run: () => inScratch('claude', true) },
      { id: 'x:chat-codex', label: 'Chat with Codex', detail: 'Read-only sandbox: its commands cannot change files', icon: 'agent', run: () => inScratch('codex', true) },
    ];
    const pages: Command[] = [
      { id: 'g:usage', label: 'Usage and spend', icon: 'usage', chord: chordFor('openUsage'), run: openUsage },
      { id: 'g:settings', label: 'Settings', icon: 'settings', chord: chordFor('openSettings'), run: () => (page = 'settings') },
      { id: 'g:shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', chord: chordFor('showShortcuts'), run: () => (page = 'shortcuts') },
    ];
    // The pages are listed above, so their actions are not listed twice.
    const listed: Action[] = ['palette', 'openUsage', 'openSettings', 'showShortcuts'];
    const actions: Command[] = actionList()
      .filter((a) => !listed.includes(a.action))
      .map((a) => ({ id: `a:${a.action}`, label: a.label, icon: ACTION_ICONS[a.action] ?? 'chevron', chord: a.chord, run: () => runAction(a.action) }));
    const live = appState.index.projects.filter((p) => p.path && p.exists && !p.kind);
    const projectCmds: Command[] = live.flatMap((p) => [
      { id: `p:${p.key}`, label: p.name, detail: `Open a shell, ${p.path}`, icon: 'terminal', run: () => void openProject(p) },
      { id: `pa:${p.key}`, label: `New agent in ${p.name}`, detail: p.path ?? '', icon: 'agent', run: () => (picker = { project: p }) },
    ]);
    const sessions = appState.index.projects
      .flatMap((p) => p.sessions.map((s) => ({ p, s })))
      .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
    const sessionCmd = ({ p, s }: (typeof sessions)[number]): Command => ({
      id: `s:${sessionKey(s)}`,
      label: s.label,
      detail: `Resume, ${providerName(s.provider)} in ${p.name}, ${relativeTime(s.mtimeMs)}`,
      icon: 'agent',
      run: () => void openSession(p, s),
    });
    return {
      all: [...tabCmds, ...pages, ...extras, ...actions, ...projectCmds, ...sessions.map(sessionCmd)],
      initial: [...tabCmds, ...pages, ...sessions.slice(0, 10).map(sessionCmd), ...extras, ...actions],
    };
  }

  const askAgent = (provider: AgentProvider) => inScratch(provider);

  function openSession(p: Project, s: SessionMeta) {
    const cwd = s.cwd ?? p.path;
    if (!cwd) return;
    // A fresh launch already bound to this conversation is reused too.
    const existing = listTabs().find(t => t.boundSession === sessionKey(s));
    if (existing) { activate(existing.key); return; }
    return guard(async () => openTab(`session:${sessionKey(s)}`, s.label,
      { cwd, initialCommand: await agentCommand(s.provider, s.id) }, p.key, s.provider));
  }

  $effect(() => { bindSessions(tabToSession, appState.index.projects.flatMap(p => p.sessions)); });

  /**
   * Every close goes through here, button or chord. A tab at a bare prompt closes at
   * once; one with a live process asks first, naming what would be stopped.
   */
  async function requestClose(key: TabKey) {
    const tab = getTab(key);
    if (!tab) return;
    const running = appState.settings?.ui.confirmClose === false ? null : await busyWith(key);
    if (!running) {
      void closeTab(key);
      return;
    }
    const agent = tab.provider && /codex|claude|node/i.test(running);
    closing = { key, title: displayTitle(tab), what: agent ? `${providerName(tab.provider!)} session` : running };
  }

  function finishClose(confirmed: boolean) {
    const c = closing;
    closing = null;
    if (c && confirmed) void closeTab(c.key);
    else focusActiveTerminal();
  }

  let sidebar = $state<ReturnType<typeof Sidebar>>();
  async function focusSearch() {
    if (!sidebarOpen()) await toggleSidebar();
    await tick();
    await sidebar?.openSearch();
    (document.getElementById('sidebar-search') as HTMLInputElement | null)?.select();
  }

  /** Windows notification for a background tab, only while ATC itself is not focused. */
  /** In-app notes for background tabs, while ATC has focus and Windows would show nothing. */
  let toasts = $state<{ id: number; key: TabKey; title: string; body: string }[]>([]);
  let toastId = 0;
  function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  function attentionBody(provider: AgentProvider | null, reason: AttentionReason) {
    return reason === 'finished' ? `${provider ? providerName(provider) : 'Agent'} finished and is waiting for you.` : 'Needs your attention.';
  }

  async function notifyAttention(key: TabKey, title: string, provider: AgentProvider | null, reason: AttentionReason) {
    if (document.hasFocus()) {
      if (appState.settings?.ui.toasts === false) return;
      const id = ++toastId;
      toasts = [...toasts.filter((t) => t.key !== key), { id, key, title, body: attentionBody(provider, reason) }].slice(-3);
      setTimeout(() => dismissToast(id), (appState.settings?.ui.toastSeconds || 6) * 1000);
      return;
    }
    if (appState.settings?.ui.notifications === false) return;
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (!granted) return;
      sendNotification({ title, body: attentionBody(provider, reason) });
    } catch (e) {
      console.warn('notification failed', e);
    }
  }

  /** The sidebar project the focused tab belongs to, if it has one. */

  function activeProject(): Project | undefined {
    const key = activeKey ? getTab(activeKey)?.projectKey : null;
    return key ? appState.index.projects.find((p) => p.key === key) : undefined;
  }

  // One implementation of every chord, so a shortcut behaves identically whether focus
  // is in the terminal or the sidebar.
  function runAction(action: Action) {
    switch (action) {
      case 'toggleSidebar':
        void toggleSidebar();
        break;
      case 'newTab':
        void newTab();
        break;
      case 'toggleDebug':
        showDebug = !showDebug;
        break;
      case 'closeTab':
        if (activeKey) requestClose(activeKey);
        break;
      case 'nextTab':
        cycleTab(1);
        break;
      case 'prevTab':
        cycleTab(-1);
        break;
      case 'toggleDevtools':
        void openDevtools();
        break;
      case 'find':
        // Re-opening while already open should put the cursor back in the box.
        showFind = false;
        void tick().then(() => (showFind = true));
        break;
      case 'zoomIn':
        void adjustZoom(1);
        break;
      case 'zoomOut':
        void adjustZoom(-1);
        break;
      case 'zoomReset':
        void adjustZoom(0);
        break;
      case 'openAgentHere': {
        const p = activeProject();
        if (p) picker = { project: p };
        else error = 'This tab is not in a project, so there is nowhere to open an agent.';
        break;
      }
      case 'openShellHere': {
        const p = activeProject();
        if (p) void newShellIn(p);
        else error = 'This tab is not in a project, so there is nowhere to open a terminal.';
        break;
      }
      case 'renameTab':
        if (activeKey) startRename(activeKey);
        break;
      case 'openSettings':
        togglePage('settings');
        break;
      case 'openUsage':
        // In front already: back to the terminal, which takes the page out of view.
        if (page === 'usage') focusActiveTerminal();
        else openUsage();
        break;
      case 'showShortcuts':
        togglePage('shortcuts');
        break;
      case 'focusSearch':
        void focusSearch();
        break;
      case 'switchSidebarView':
        if (!sidebarOpen()) void toggleSidebar();
        void setSidebarView(({ sessions: 'open', open: 'scratch', scratch: 'sessions' } as const)[sidebarView()]);
        break;
      case 'askAgent':
        picker = { project: null };
        break;
      case 'palette':
        paletteOpen = true;
        break;
      case 'toggleSplit':
        void toggleSplit();
        break;
      case 'focusOtherPane':
        focusOtherPane();
        break;
      case 'jumpWaiting': {
        const next = nextWaiting(tabs.map((t) => ({ ...t, mark: tabMark(t) })), activeKey);
        if (next) activate(next.key);
        break;
      }
      case 'toggleMosaic':
        toggleMosaic();
        break;
    }
  }

  onMount(() => {
    const off = onChange(sync);
    // Chords pressed while the terminal has focus arrive here, already consumed by
    // xterm's interceptor so they never reach the shell.
    const offChord = onChord(runAction);
    const offAttention = onAttention((t, reason) => void notifyAttention(t.key, displayTitle(t), t.provider, reason));
    mountTerminals(wrapper);
    const onPaneFocus = () => {
      if (page === 'usage') page = null;
    };
    wrapper.addEventListener('focusin', onPaneFocus);
    // The tab bar's chip shows the limits all the time, not only on the usage page.
    void loadClaudeLimits();
    const clock = setInterval(() => (now = Date.now()), 15_000);
    // Settings decide whether the sidebar is open, and so how wide the pane is.
    // Spawning before that lands starts the PTY at the wrong width.
    void (async () => {
      await initStores();
      const restored = await restoreTabs();
      restoring = false;
      if (!restored) await newTab();
      sync();
    })();

    // Covers focus being anywhere outside the terminal -- the sidebar, a button.
    const onKey = (e: KeyboardEvent) => {
      if (picker || paletteOpen) return;
      const action = matchChord(e);
      if (!action) return;
      // Behind a popup the app is inert; only its own chord, or the other popup's, acts.
      if (popup && action !== 'openSettings' && action !== 'showShortcuts') return;
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', refit);
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      off();
      offChord();
      offAttention();
      wrapper.removeEventListener('focusin', onPaneFocus);
      clearInterval(clock);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', refit);
    };
  });

  // Re-armed when the refresh setting changes.
  $effect(() => {
    const poll = setInterval(() => void loadClaudeLimits(), refreshMs('claude'));
    return () => clearInterval(poll);
  });

  // The terminal shares the wrapper's geometry, so it re-measures whenever the panel
  // changes; otherwise ConPTY keeps the old column count. Waiting any longer than
  // refit's own debounce leaves the terminal clipped at its old width, then jumping.
  $effect(() => {
    void width;
    refit();
  });

  // Toggling the sidebar: the column snaps and the terminal takes its final size in the
  // same frame, then slides with the drawer. Resizing after the slide made it jump.
  let main: HTMLElement;
  $effect(() => {
    const isOpen = open;
    // Untracked: startup ending is not a toggle.
    if (untrack(() => restoring)) return refit();
    refitNow();
    const ms = enterMs();
    const w = untrack(() => width);
    if (ms) main.animate([{ transform: `translateX(${isOpen ? -w : w}px)` }, { transform: 'none' }], { duration: ms, easing: DRAWER_EASE });
  });
</script>

<div class="app" style="--panel: {open ? width : 0}px">

  <aside class="panel" inert={popup}>
    {#if open}
      <div
        class="drawer"
        style="width: {width}px"
        transition:fly={{ x: -width, opacity: 1, duration: restoring ? 0 : enterMs(), easing: cubicOut }}
      >
      <div
        class="resize"
        class:dragging={dragWidth !== null}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize, double-click to reset"
        onpointerdown={startResize}
        ondblclick={() => saveSidebarWidth(SIDEBAR_DEFAULT)}
      ></div>
      <Sidebar
        bind:this={sidebar}
        {activeKey}
        {activeSessionId}
        {openProjectKeys}
        {sessionMarks}
        onOpenProject={openProject}
        onOpenSession={openSession}
        onNewShell={newShellIn}
        onNewAgent={newAgentIn}
        onNewChat={(provider) => inScratch(provider, true)}
        onPickAgent={(p) => (picker = { project: p })}
        onOpenFolder={openFolder}
        onAsk={askAgent}
        {tabs}
        onNewTab={newTab}
        onCloseTab={requestClose}
        onRenameTab={startRename}
        onDispatch={dispatch}
      />
      </div>
    {/if}
  </aside>

  <section class="main" bind:this={main} inert={popup}>
    <!-- In place of a tab bar: the sidebar's Open view switches tabs, this names the one shown. -->
    <header class="bar">
      <button class="bar-btn" class:on={open} onclick={() => toggleSidebar()} title="Toggle sidebar (Ctrl+Shift+B)" aria-label="Toggle sidebar">
        <Icon name="sidebar" />
      </button>
      {#if page === 'usage'}
        <span class="shown"><Icon name="usage" size={14} /><b>Usage and spend</b></span>
        <button class="bar-btn" onclick={closeUsage} title="Close usage" aria-label="Close usage"><Icon name="close" size={12} /></button>
      {:else if shown}
        {@const mark = tabMark(shown)}
        <span class="shown" title="{shown.title} (double-click or Ctrl+Shift+R to rename)">
          <StatusDot {mark} title={markTitle(mark, providerName(shown.provider ?? 'claude'))} />
          {#if shown.provider}<ProviderIcon provider={shown.provider} />{:else}<Icon name="terminal" size={12} />{/if}
          {#if renamingTab === shown.key}
            <InlineRename value={shown.title} onDone={finishRename} onCancel={() => finishRename()} />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions (Ctrl+Shift+R is the keyboard way) -->
            <b class:exited={shown.exited} ondblclick={() => startRename(shown.key)}>{shown.title}</b>
          {/if}
          <span class="facts">{shownFacts}</span>
        </span>
        <button class="bar-btn" onclick={() => requestClose(shown.key)} title="Close {shown.title} (Ctrl+Shift+W)" aria-label="Close {shown.title}"><Icon name="close" size={12} /></button>
      {:else}
        <span class="shown facts">Nothing open</span>
      {/if}
      <div class="new-split">
        <button class="bar-btn" onclick={() => newTab()} title="New shell (Ctrl+Shift+T)" aria-label="New shell"><Icon name="plus" /></button>
        <button class="bar-btn caret" onclick={newMenu} title="New shell, Claude or Codex" aria-label="New shell, Claude or Codex">
          <Icon name="chevronDown" size={12} />
        </button>
      </div>
      <div class="grow"></div>
      {#if currentZoom() !== 1}
        <button class="bar-btn zoom" onclick={() => adjustZoom(0)} title="Reset zoom (Ctrl+0)">{zoomLabel(currentZoom())}</button>
      {/if}
      <UsageChip active={page === 'usage'} onOpen={openUsage} onClose={closeUsage} />
      <button class="bar-btn" onclick={moreMenu} title="Usage, settings and shortcuts" aria-label="More"><Icon name="more" /></button>
    </header>
    <div class="panes" bind:this={wrapper}>
      {#if split}
        <div
          class="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          title="Drag to resize, double-click to make them equal"
          style="left: {splitRatio * 100}%"
          onpointerdown={dragSplit}
          ondblclick={() => setSplitRatio(0.5)}
        ></div>
      {/if}
    </div>
    {#if page === 'usage'}
      <UsagePanel onClose={closeUsage} sessionKey={activeSessionId} />
    {/if}
    {#if showFind}
      <FindBar onClose={() => (showFind = false)} />
    {/if}
    {#if showDebug}
      <DebugOverlay {activeKey} />
    {/if}
    {#if contextMenu}
      <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} dropdown={contextMenu.dropdown} onClose={() => (contextMenu = null)} />
    {/if}
    {#if paletteOpen}
      {@const cmds = paletteCommands()}
      <CommandPalette commands={cmds.all} initial={cmds.initial} onClose={() => (paletteOpen = false)} />
    {/if}
    {#if picker}
      <ProviderPicker
        title={picker.project ? `New agent in ${picker.project.name}` : 'Ask an agent'}
        detail={picker.project?.path ?? null}
        onPick={finishPicker}
        onCancel={() => finishPicker()}
      />
    {/if}
    {#if closing}
      <ConfirmDialog
        confirmLabel="Close tab"
        onConfirm={() => finishClose(true)}
        onCancel={() => finishClose(false)}
      >
        Close <strong>{closing.title}</strong>? The {closing.what} running in it will be stopped.
      </ConfirmDialog>
    {/if}
    <div class="corner" aria-live="polite">
      {#each toasts as t (t.id)}
        <div class="toast">
          <button class="toast-body" onclick={() => { activate(t.key); dismissToast(t.id); }} title="Go to this tab">
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </button>
          <button class="dismiss" onclick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      {/each}
      {#if error}
        <div class="error">
          {error}
          <button class="dismiss" onclick={() => (error = null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      {/if}
    </div>
  </section>

  <!-- Popups, outside everything they make inert. -->
  {#if page === 'settings'}
    <SettingsPanel onClose={() => (page = null)} />
  {:else if page === 'shortcuts'}
    <ShortcutsPanel onClose={() => (page = null)} />
  {/if}
</div>
<Tooltip />

<style>
  .app {
    display: grid;
    height: 100%;
    grid-template-columns: var(--panel) 1fr;
  }
  /* The drawer is not clipped to its column: sliding out, it overlays the terminal that
     has already taken the column back, and leaves by the window's edge. */
  .panel {
    position: relative;
  }
  .bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    height: 34px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
    background: var(--glass-chrome);
  }
  .grow {
    flex: 1;
  }
  .shown {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding: 0 6px;
    overflow: hidden;
    color: var(--fg-bright);
    font-size: 12px;
    white-space: nowrap;
  }
  .shown b {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
  }
  .shown b.exited {
    opacity: 0.6;
    text-decoration: line-through;
  }
  .facts {
    min-width: 0;
    overflow: hidden;
    color: var(--fg-faint);
    text-overflow: ellipsis;
  }
  .bar-btn {
    display: grid;
    width: 28px;
    height: 26px;
    flex: none;
    align-self: center;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .bar-btn:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .bar-btn:active {
    transform: scale(0.92);
  }
  .bar-btn.on {
    color: var(--accent);
  }
  .bar-btn.zoom {
    width: auto;
    padding: 0 6px;
    color: var(--accent);
    font-size: 11px;
  }
  /* New shell, and beside it the choice of what to start. One rounded piece: hovering
     either half lights the whole of it, the half under the pointer a shade more. */
  .new-split {
    display: flex;
    align-self: center;
    margin-left: 4px;
    overflow: hidden;
    border-radius: 6px;
    transition: background-color var(--fast);
  }
  .new-split:hover {
    background: var(--bg-hover);
  }
  .new-split .bar-btn {
    border-radius: 0;
  }
  .new-split .bar-btn:hover {
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }
  .new-split .bar-btn:active {
    transform: none;
  }
  .new-split .caret {
    width: 22px;
  }
  .new-split:hover .caret {
    box-shadow: inset 1px 0 0 var(--border);
  }
  .drawer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 1;
  }
  /* Centred on the sidebar's border. The line and grip wait a beat on hover, so passing
     the mouse across does not flash them. */
  .resize {
    position: absolute;
    top: 0;
    right: -4px;
    bottom: 0;
    z-index: 5;
    width: 8px;
    cursor: col-resize;
  }
  .split-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 3;
    width: 8px;
    margin-left: -4px;
    cursor: col-resize;
  }
  .resize::before,
  .resize::after,
  .split-handle::before,
  .split-handle::after {
    position: absolute;
    left: 3px;
    width: 2px;
    background: var(--accent);
    content: '';
    opacity: 0;
    transition: opacity var(--fast);
  }
  .resize::before,
  .split-handle::before {
    top: 0;
    bottom: 0;
  }
  .resize::after,
  .split-handle::after {
    top: 50%;
    left: 1px;
    width: 6px;
    height: 32px;
    margin-top: -16px;
    border-radius: 3px;
  }
  .resize:hover::before,
  .resize:hover::after,
  .split-handle:hover::before,
  .split-handle:hover::after {
    opacity: 1;
    transition-delay: 150ms;
  }
  .resize.dragging::before,
  .resize.dragging::after {
    opacity: 1;
  }
  .main {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
  }
  /* Every terminal pane is absolutely positioned inside this one box, so they all
     share its geometry and can be measured once. */
  .panes {
    position: relative;
    overflow: hidden;
    background: var(--bg);
    flex: 1;
    min-height: 0;
    padding: 6px 0 0 8px;
  }
  /* The mosaic's tile names. Tiles are scaled down, so the label is scaled up to match.
     The label carries the state colour, since xterm's canvas paints over any border. */
  .panes :global([data-tile])::after {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    padding: calc(4px * var(--tile-scale)) calc(8px * var(--tile-scale));
    background: var(--bg-chrome);
    color: var(--fg-bright);
    content: attr(data-tile);
    font-size: calc(12px * var(--tile-scale));
  }
  .panes :global([data-mark='attention'])::after {
    background: var(--accent);
    color: var(--bg);
  }
  .panes :global([data-mark='working'])::after {
    background: var(--warn);
    color: var(--bg);
  }
  .panes :global([data-mark='idle'])::after {
    background: var(--ok);
    color: var(--bg);
  }
  .panes :global([data-mark='interrupted'])::after {
    background: var(--danger);
    color: var(--bg);
  }
  /* Toasts and the error stack here, newest at the bottom, so they never overlap. */
  .corner {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 25;
    display: flex;
    max-width: min(60%, 420px);
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .toast,
  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    pointer-events: auto;
    animation: atc-rise var(--enter) var(--ease-out);
  }
  .toast {
    padding: 4px 6px 4px 4px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    background: var(--bg-chrome);
  }
  .toast-body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .toast-body:hover {
    background: var(--bg-hover);
  }
  .toast-body strong {
    overflow: hidden;
    color: var(--fg-bright);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    padding: 8px 8px 8px 12px;
    border: 1px solid var(--danger-strong);
    background: color-mix(in srgb, var(--danger) 12%, var(--bg-chrome));
    color: var(--danger);
  }
  .dismiss {
    padding: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .toast .dismiss {
    color: var(--fg-faint);
  }
  .dismiss:hover {
    background: var(--bg-hover);
  }
</style>
