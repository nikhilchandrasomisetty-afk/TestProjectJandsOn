// Unified input: desktop uses pointer lock + WASD; touch devices get a virtual
// joystick, a look area, and on-screen action buttons. Both feed the same state object.

export class InputManager {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.state = {
      forward: 0, strafe: 0,
      jump: false, sprint: false, crouch: false,
      breaking: false, placing: false,
    };
    this.lookDelta = { x: 0, y: 0 };
    this.keys = new Set();
    this.pointerLocked = false;
    this.sensitivity = 0.0022;
    this.touchSensitivity = 0.0042;
    this.invertY = false;
    this.enabled = false;
    this.handlers = {};        // action name -> callback
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.placeTapPending = false;

    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
  }

  on(action, fn) { this.handlers[action] = fn; }
  fire(action, ...args) { if (this.handlers[action]) this.handlers[action](...args); }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      this.state.forward = this.state.strafe = 0;
      this.state.jump = this.state.sprint = this.state.crouch = false;
      this.state.breaking = this.state.placing = false;
      this.keys.clear();
    }
  }

  requestLock() {
    if (this.isTouch) return;
    if (document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _updateMoveFromKeys() {
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (!this.touchMove) {
      this.state.forward = f;
      this.state.strafe = s;
    }
    this.state.jump = this.keys.has('Space') || !!this.touchJump;
    this.state.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || !!this.touchSprint;
    this.state.crouch = this.keys.has('ControlLeft') || this.keys.has('KeyC') || !!this.touchCrouch;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Menu-level keys work even when gameplay input is disabled
      if (e.code === 'Escape') { this.fire('escape'); return; }
      if (!this.enabled) return;

      if (e.code === 'KeyE') { e.preventDefault(); this.fire('toggleInventory'); return; }
      if (e.code === 'KeyQ') { e.preventDefault(); this.fire('dropItem'); return; }
      if (e.code === 'KeyF') { e.preventDefault(); this.fire('toggleCrafting'); return; }
      if (e.code === 'KeyG') { e.preventDefault(); this.fire('toggleMode'); return; }
      if (e.code === 'F3' || e.code === 'KeyH') { e.preventDefault(); this.fire('toggleDebug'); return; }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) { this.fire('selectSlot', n - 1); return; }
      }
      if (e.code === 'Space') {
        e.preventDefault();
        // Double-tap space toggles flight in creative
        const now = performance.now();
        if (!this.keys.has('Space') && now - (this._lastSpace || 0) < 320) this.fire('toggleFly');
        if (!this.keys.has('Space')) this._lastSpace = now;
      }
      this.keys.add(e.code);
      this._updateMoveFromKeys();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._updateMoveFromKeys();
    });

    window.addEventListener('blur', () => { this.keys.clear(); this._updateMoveFromKeys(); });
  }

  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.fire('pointerLockChange', this.pointerLocked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.lookDelta.x += e.movementX * this.sensitivity;
      this.lookDelta.y += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.pointerLocked) { this.requestLock(); return; }
      if (e.button === 0) this.state.breaking = true;
      if (e.button === 2) { this.state.placing = true; this.fire('place'); }
      if (e.button === 1) { e.preventDefault(); this.fire('pickBlock'); }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.state.breaking = false;
      if (e.button === 2) this.state.placing = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('wheel', (e) => {
      if (!this.enabled || !this.pointerLocked) return;
      this.fire('scrollSlot', e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  _bindTouch() {
    const joyZone = document.getElementById('touch-joystick');
    const lookZone = document.getElementById('touch-look');
    if (!joyZone || !lookZone) return;

    let joyId = null, joyOrigin = { x: 0, y: 0 };
    const knob = document.getElementById('joystick-knob');

    const setKnob = (dx, dy) => {
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const rect = joyZone.getBoundingClientRect();
      joyOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.touchMove = true;
    }, { passive: false });

    const joyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        e.preventDefault();
        let dx = t.clientX - joyOrigin.x;
        let dy = t.clientY - joyOrigin.y;
        const max = 52;
        const len = Math.hypot(dx, dy);
        if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
        setKnob(dx, dy);
        this.state.strafe = dx / max;
        this.state.forward = -dy / max;
        this.touchSprint = len > max * 0.86;
      }
    };
    joyZone.addEventListener('touchmove', joyMove, { passive: false });

    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        joyId = null;
        this.touchMove = false;
        this.touchSprint = false;
        this.state.forward = 0;
        this.state.strafe = 0;
        setKnob(0, 0);
      }
    };
    joyZone.addEventListener('touchend', joyEnd);
    joyZone.addEventListener('touchcancel', joyEnd);

    // Look area: drag to look; a quick tap breaks the targeted block
    let lookId = null, lastLook = { x: 0, y: 0 }, lookStart = 0, lookMoved = 0;
    lookZone.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches[0];
      if (lookId !== null) return;
      lookId = t.identifier;
      lastLook = { x: t.clientX, y: t.clientY };
      lookStart = performance.now();
      lookMoved = 0;
    }, { passive: true });

    lookZone.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        const dx = t.clientX - lastLook.x;
        const dy = t.clientY - lastLook.y;
        lastLook = { x: t.clientX, y: t.clientY };
        lookMoved += Math.abs(dx) + Math.abs(dy);
        this.lookDelta.x += dx * this.touchSensitivity;
        this.lookDelta.y += dy * this.touchSensitivity * (this.invertY ? -1 : 1);
      }
    }, { passive: true });

    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        lookId = null;
        if (lookMoved < 14 && performance.now() - lookStart < 260) this.fire('tapBreak');
      }
    };
    lookZone.addEventListener('touchend', lookEnd);
    lookZone.addEventListener('touchcancel', lookEnd);

    // Action buttons
    const hold = (id, down, up) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('pressed'); down(); }, { passive: false });
      const end = (e) => { e.preventDefault(); el.classList.remove('pressed'); if (up) up(); };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };

    hold('btn-jump', () => { this.touchJump = true; }, () => { this.touchJump = false; });
    hold('btn-break', () => { this.state.breaking = true; }, () => { this.state.breaking = false; });
    hold('btn-place', () => { this.fire('place'); });
    hold('btn-crouch', () => { this.touchCrouch = !this.touchCrouch; });
    hold('btn-fly', () => { this.fire('toggleFly'); });

    // Double-tap jump toggles flight on touch too
    const jumpBtn = document.getElementById('btn-jump');
    if (jumpBtn) {
      let lastTap = 0;
      jumpBtn.addEventListener('touchstart', () => {
        const now = performance.now();
        if (now - lastTap < 320) this.fire('toggleFly');
        lastTap = now;
      }, { passive: true });
    }
  }

  consumeLook() {
    const d = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return d;
  }

  tick() { this._updateMoveFromKeys(); }
}
