// Styles for the PiP controls shadow root. `all: initial` on the host stops
// site styles (copied into the PiP window) from leaking in via inheritance.
export const CONTROLS_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #f2f2f2;
}
.root {
  position: absolute; inset: 0; opacity: 0; transition: opacity 0.2s;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #f2f2f2;
}
.root.visible, .root.dropping { opacity: 1; }
.root.dropping::after {
  content: 'Drop a subtitle file (SRT or VTT)'; position: absolute; inset: 8px; z-index: 1;
  display: grid; place-items: center; padding: 12px; text-align: center; font-size: 14px;
  border: 2px dashed #ff4d5e; border-radius: 12px; background: rgba(17, 18, 20, 0.85); pointer-events: none;
}
.root:not(.visible) .bar, .root:not(.visible) .menu { pointer-events: none; }
.fade {
  position: absolute; left: 0; right: 0; bottom: 0; height: 120px; max-height: 60%;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); pointer-events: none;
}
.bar {
  position: absolute; left: 10px; right: 10px; bottom: 6px;
  display: flex; flex-direction: column; gap: 2px; pointer-events: auto;
}
.seek { position: relative; height: 14px; display: flex; align-items: center; }
.no-seek .seek { visibility: hidden; }
.seek-input {
  -webkit-appearance: none; appearance: none; width: 100%; height: 3px; margin: 0;
  border-radius: 3px; cursor: pointer; outline: none; transition: height 0.1s;
  background: linear-gradient(to right, #ff4d5e var(--p, 0%), rgba(255, 255, 255, 0.25) var(--p, 0%));
}
.seek:hover .seek-input { height: 5px; }
.seek-input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 11px; height: 11px; border: 0; border-radius: 50%; background: #ff4d5e;
}
.tip {
  position: absolute; bottom: 16px; transform: translateX(-50%);
  padding: 2px 6px; border-radius: 4px; background: rgba(17, 18, 20, 0.95);
  font-size: 11px; white-space: nowrap; pointer-events: none;
}
.row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.btn {
  all: unset; box-sizing: border-box; flex: none; width: 30px; height: 30px;
  display: grid; place-items: center; border-radius: 8px; color: #f2f2f2; cursor: pointer;
}
.btn:hover { background: rgba(255, 255, 255, 0.1); }
.btn svg { display: block; width: 18px; height: 18px; }
.btn[aria-pressed="false"] { color: #8b8d93; }
.btn[aria-expanded="true"] { color: #ff4d5e; }
:focus-visible { outline: 2px solid #ff4d5e; outline-offset: 2px; }
.vol { display: flex; align-items: center; flex: none; }
.vol-input {
  -webkit-appearance: none; appearance: none; width: 0; height: 3px; margin: 0; opacity: 0;
  border-radius: 3px; background: rgba(255, 255, 255, 0.35); transition: width 0.15s, opacity 0.15s, margin 0.15s;
}
.vol:hover .vol-input, .vol:focus-within .vol-input { width: 56px; opacity: 1; margin: 0 6px 0 2px; }
.vol-input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%; background: #f2f2f2;
}
.time { margin-left: 6px; color: #b8bac0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.spacer { flex: 1; min-width: 0; }
.menu {
  position: absolute; right: 10px; bottom: 60px; width: 220px;
  max-width: calc(100% - 20px); max-height: calc(100% - 76px); overflow: auto;
  box-sizing: border-box; padding: 6px; border: 1px solid #25262a; border-radius: 12px;
  background: #111214; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); pointer-events: auto;
}
.menu[hidden] { display: none; }
.menu-item {
  all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; font-size: 12px; color: #f2f2f2; cursor: pointer;
}
.menu-item:hover { background: rgba(255, 255, 255, 0.07); }
.menu-item:focus-visible { outline: 2px solid #ff4d5e; outline-offset: -2px; }
.menu-item svg { display: block; width: 14px; height: 14px; flex: none; }
.menu-item .value {
  margin-left: auto; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8b8d93;
}
.menu-item .check { color: #ff4d5e; visibility: hidden; }
.menu-item[aria-checked="true"] .check { visibility: visible; }
.menu-item.head { font-weight: 600; }
.tag {
  margin-left: auto; padding: 2px 6px; border-radius: 99px; font-size: 10px; font-weight: 600;
  background: rgba(255, 77, 94, 0.15); color: #ff7a86;
}
.menu-note { padding: 8px 10px; font-size: 12px; line-height: 1.4; color: #8b8d93; }
@media (max-width: 360px) {
  .skip, .time { display: none; }
}
`;
