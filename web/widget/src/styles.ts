/** Widget CSS, scoped by the Shadow DOM. --ab-accent comes from the widget's colour setting. */
export const STYLES = `
:host { all: initial; }
.ab {
  --ab-accent: #18181b;
  --ab-bg: #ffffff; --ab-fg: #18181b; --ab-muted: #71717a; --ab-line: #e4e4e7; --ab-soft: #f4f4f5;
  --ab-danger: #b91c1c;
  position: fixed; bottom: 20px; z-index: 2147483000;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  color: var(--ab-fg);
  display: flex; flex-direction: column; gap: 12px;
}
@media (prefers-color-scheme: dark) {
  .ab { --ab-bg: #18181b; --ab-fg: #f4f4f5; --ab-muted: #a1a1aa; --ab-line: #3f3f46; --ab-soft: #27272a; --ab-danger: #f87171; }
}
.ab-right { right: 20px; align-items: flex-end; }
.ab-left { left: 20px; align-items: flex-start; }
.ab button { font: inherit; cursor: pointer; border: 0; }
.ab button:focus-visible { outline: 2px solid var(--ab-accent); outline-offset: 2px; }
.ab svg { width: 18px; height: 18px; fill: currentColor; flex: none; }

.ab-launcher {
  display: inline-flex; align-items: center; gap: 8px; padding: 12px 18px; border-radius: 999px;
  background: var(--ab-accent); color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.18); font-weight: 600;
}
.ab-launcher.ab-live { animation: ab-pulse 1.6s ease-in-out infinite; }
@keyframes ab-pulse { 50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--ab-accent) 25%, transparent); } }

.ab-panel {
  width: min(340px, calc(100vw - 40px)); background: var(--ab-bg); border: 1px solid var(--ab-line);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.18); padding: 16px; box-sizing: border-box;
}
.ab-panel[hidden] { display: none; }
.ab-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.ab-head strong { font-size: 15px; }
.ab-icon { background: transparent; color: var(--ab-muted); padding: 4px; border-radius: 8px; display: inline-flex; }
.ab-icon:hover { background: var(--ab-soft); }
.ab-status { margin: 0 0 10px; color: var(--ab-muted); min-height: 20px; }
.ab-captions {
  max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;
}
.ab-captions[hidden], .ab-captions:empty { display: none; }
.ab-line { margin: 0; padding: 6px 10px; border-radius: 10px; background: var(--ab-soft); }
.ab-line.ab-you { background: transparent; border: 1px solid var(--ab-line); }
.ab-line.ab-partial { opacity: .7; }
.ab-who { display: block; font-size: 11px; color: var(--ab-muted); }
.ab-note { margin: 0 0 10px; color: var(--ab-danger); }
.ab-note[hidden], .ab-note:empty { display: none; }
.ab-controls { display: flex; gap: 8px; }
.ab-call {
  flex: 1; padding: 10px 14px; border-radius: 10px; background: var(--ab-accent); color: #fff; font-weight: 600;
}
.ab-call.ab-end { background: var(--ab-danger); }
.ab-mute { padding: 10px 14px; border-radius: 10px; background: var(--ab-soft); color: var(--ab-fg); }
.ab-mute[hidden] { display: none; }
.ab-foot { margin: 10px 0 0; font-size: 12px; color: var(--ab-muted); }
@media (prefers-reduced-motion: reduce) { .ab-launcher.ab-live { animation: none; } }
`;
