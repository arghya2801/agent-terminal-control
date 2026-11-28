# Customizing how ATC looks

Most of the look is in Settings: Appearance, Chat and Show. This page covers what goes past those: theme files, `user.css` and the CSS variables both of them set.

Files live in the config folder, `%APPDATA%\Agent Terminal Control`.

## Theme files

`themes\<name>.json` adds a theme. The shape is the one Windows Terminal and VS Code terminal themes use: `background`, `foreground`, `cursor`, `selection` and the 16 ANSI colours. A file named like a built-in theme replaces it. Settings > Appearance > Edit makes one from the current theme, and can import a VS Code colour theme.

The app's own colours are mixed from the palette. A `ui` block sets any of them directly:

```json
{
  "name": "My Mocha",
  "background": "#1e1e2e",
  "foreground": "#cdd6f4",
  "ui": { "--bg-surface": "#313244", "--border": "#45475a", "--claude": "#f5c2e7" }
}
```

Keys must start with `--`. Values can't contain `;`, `{`, `}`, `<` or `>`.

## user.css

`user.css` loads after the app's styles and reloads when the file is saved. Settings > Config lists it as "ATC styles", so you can edit it in the app.

```css
:root { --ui-scale: 1.1 !important; }
.bubble { border-style: dashed; }
```

The theme sets its variables on the root element's `style`, so a variable override in `user.css` needs `!important`. Selectors other than the variables below can change between versions.

## Variables

| Variable | What it sets |
|---|---|
| `--bg`, `--bg-chrome`, `--bg-surface`, `--bg-hover` | Background, then the sidebar and title bar, panels and menus, hover |
| `--fg`, `--fg-bright`, `--fg-dim`, `--fg-faint` | Text, from body text down to the faintest hint |
| `--border` | Borders and dividers |
| `--accent`, `--accent-strong`, `--on-accent` | Accent, its stronger shade, text drawn on it |
| `--danger`, `--danger-strong`, `--warn`, `--ok`, `--info` | Status colours |
| `--selection`, `--on-selection` | Selected text |
| `--claude`, `--codex` | Provider colours |
| `--chart-1` … `--chart-5` | Usage chart series |
| `--shadow-pop` | Menu and popup shadow |
| `--ui-font`, `--ui-scale` | App font, text size multiplier (Settings: App font, Text size) |
| `--radius-scale` | Corner rounding multiplier (Settings: Corners) |
| `--chat-width`, `--chat-line`, `--chat-gap`, `--user-width` | Chat column width, line height, spacing multiplier, your messages' width |
| `--fast`, `--enter` | Animation durations (Settings: Animation speed) |
