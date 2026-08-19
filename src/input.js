// Input abstraction covering three control schemes:
//   1. Pointer lock (normal desktop play)
//   2. Click-and-drag look, used when pointer lock is denied — which is what
//      happens inside sandboxed iframes that lack allow-pointer-lock
//   3. Touch: a left-side virtual stick plus right-side look drag
//
// Everything above resolves to the same movement flags and callbacks, so the
// game loop never needs to know which scheme is active.

const CLICK_SLOP = 6; // px of travel still counted as a click, not a drag

export class Input {
  constructor(element) {
    this.element = element;

    this.forward = false;
    this.back = false;
    this.left = false;
    this.right = false;
    this.jump = false;
    this.sneak = false;
    this.sprint = false;

    this.attacking = false;
    this.using = false;

    this.active = false;
    this.pointerLocked = false;
    this.fallbackMode = false;
    this.touchMode = false;
    this.sensitivity = 0.0022;

    this.onLook = null;
    this.onAttackStart = null;
    this.onUseStart = null;
    this.onActivate = null;
    this.onDeactivate = null;
    this.onCommand = null; // (name) => void

    this._dragging = false;
    this._dragTravel = 0;
    this._dragButton = 0;
    this._lastSprintTap = 0;
    this._lookTouchId = null;
    this._moveTouchId = null;
    this._moveOrigin = { x: 0, y: 0 };
    this._lockAttemptAt = 0;

    this._bind();
  }

  get isTouchDevice() {
    return (
      typeof window !== "undefined" &&
      ("ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0)
    );
  }

  // --- activation -----------------------------------------------------------

  activate() {
    if (this.active) return;

    if (this.isTouchDevice) {
      this.touchMode = true;
      this._setActive(true);
      return;
    }

    this._lockAttemptAt = performance.now();
    const promise = this.element.requestPointerLock?.({ unadjustedMovement: false });
    // Chrome returns a promise; a rejection means the lock was refused.
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => this._enterFallback());
    }

    // Some embedders neither fire pointerlockerror nor reject the promise, so
    // verify the lock actually took hold and fall back if it silently failed.
    setTimeout(() => {
      if (!this.pointerLocked && !this.active) this._enterFallback();
    }, 350);
  }

  deactivate() {
    if (this.pointerLocked) document.exitPointerLock?.();
    this._setActive(false);
    this.fallbackMode = false;
    this._clearMovement();
  }

  _enterFallback() {
    if (this.active) return;
    this.fallbackMode = true;
    this._setActive(true);
  }

  _setActive(value) {
    if (this.active === value) return;
    this.active = value;
    if (value) this.onActivate?.(this.fallbackMode, this.touchMode);
    else this.onDeactivate?.();
  }

  _clearMovement() {
    this.forward = this.back = this.left = this.right = false;
    this.jump = this.sneak = this.sprint = false;
    this.attacking = this.using = false;
    this._dragging = false;
  }

  // --- wiring ---------------------------------------------------------------

  _bind() {
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.element;
      if (this.pointerLocked) {
        this.fallbackMode = false;
        this._setActive(true);
      } else if (!this.fallbackMode && !this.touchMode) {
        this._setActive(false);
        this._clearMovement();
      }
    });

    document.addEventListener("pointerlockerror", () => this._enterFallback());

    window.addEventListener("keydown", (e) => this._onKey(e, true));
    window.addEventListener("keyup", (e) => this._onKey(e, false));
    window.addEventListener("blur", () => this._clearMovement());

    this.element.addEventListener("mousedown", (e) => this._onMouseDown(e));
    window.addEventListener("mouseup", (e) => this._onMouseUp(e));
    window.addEventListener("mousemove", (e) => this._onMouseMove(e));
    this.element.addEventListener("contextmenu", (e) => e.preventDefault());
    this.element.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });

    this.element.addEventListener("touchstart", (e) => this._onTouchStart(e), { passive: false });
    this.element.addEventListener("touchmove", (e) => this._onTouchMove(e), { passive: false });
    this.element.addEventListener("touchend", (e) => this._onTouchEnd(e), { passive: false });
    this.element.addEventListener("touchcancel", (e) => this._onTouchEnd(e), { passive: false });
  }

  _onKey(e, down) {
    // Never swallow browser shortcuts the player might need.
    if (e.metaKey || e.ctrlKey) return;

    switch (e.code) {
      case "KeyW": case "ArrowUp":
        if (down && !this.forward) {
          const now = performance.now();
          if (now - this._lastSprintTap < 280) this.sprint = true;
          this._lastSprintTap = now;
        }
        this.forward = down;
        if (!down) this.sprint = false;
        break;
      case "KeyS": case "ArrowDown": this.back = down; break;
      case "KeyA": case "ArrowLeft": this.left = down; break;
      case "KeyD": case "ArrowRight": this.right = down; break;
      case "Space":
        this.jump = down;
        if (this.active) e.preventDefault();
        break;
      case "ShiftLeft": case "ShiftRight": this.sneak = down; break;
      case "ControlLeft": this.sprint = down; break;
      case "KeyF": if (down) this.onCommand?.("fly"); break;
      case "KeyE": if (down) this.onCommand?.("inventory"); break;
      case "KeyR": if (down) this.onCommand?.("respawn"); break;
      case "KeyG": if (down) this.onCommand?.("debug"); break;
      case "Escape": if (down) this.onCommand?.("pause"); break;
      default:
        if (down && /^Digit[1-9]$/.test(e.code)) {
          this.onCommand?.("slot:" + (Number(e.code.slice(5)) - 1));
        }
    }
  }

  _onMouseDown(e) {
    if (!this.active) {
      this.activate();
      return;
    }

    if (this.pointerLocked) {
      if (e.button === 0) { this.attacking = true; this.onAttackStart?.(); }
      if (e.button === 2) { this.using = true; this.onUseStart?.(); }
      return;
    }

    if (this.fallbackMode) {
      // Hold to look; a press that barely moves is treated as a click on release.
      e.preventDefault();
      this._dragging = true;
      this._dragTravel = 0;
      this._dragButton = e.button;
      if (e.button === 0) this.attacking = true;
    }
  }

  _onMouseUp(e) {
    if (this.pointerLocked) {
      if (e.button === 0) this.attacking = false;
      if (e.button === 2) this.using = false;
      return;
    }

    if (this.fallbackMode && this._dragging) {
      this._dragging = false;
      this.attacking = false;
      if (this._dragTravel <= CLICK_SLOP) {
        if (this._dragButton === 0) this.onAttackStart?.();
        if (this._dragButton === 2) this.onUseStart?.();
      }
    }
  }

  _onMouseMove(e) {
    if (!this.active) return;
    if (this.pointerLocked) {
      this.onLook?.(e.movementX || 0, e.movementY || 0, this.sensitivity);
    } else if (this.fallbackMode && this._dragging) {
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this._dragTravel += Math.abs(dx) + Math.abs(dy);
      // Drag-look moves further per pixel since there is no infinite surface.
      this.onLook?.(dx, dy, this.sensitivity * 1.5);
    }
  }

  _onWheel(e) {
    if (!this.active) return;
    e.preventDefault();
    this.onCommand?.(e.deltaY > 0 ? "slotNext" : "slotPrev");
  }

  // --- touch ----------------------------------------------------------------

  _onTouchStart(e) {
    if (!this.active) {
      this.activate();
      e.preventDefault();
      return;
    }
    const half = window.innerWidth / 2;
    for (const touch of e.changedTouches) {
      if (touch.clientX < half && this._moveTouchId === null) {
        this._moveTouchId = touch.identifier;
        this._moveOrigin = { x: touch.clientX, y: touch.clientY };
      } else if (touch.clientX >= half && this._lookTouchId === null) {
        this._lookTouchId = touch.identifier;
        this._lookLast = { x: touch.clientX, y: touch.clientY };
        this._lookTravel = 0;
      }
    }
    e.preventDefault();
  }

  _onTouchMove(e) {
    if (!this.active) return;
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._moveTouchId) {
        const dx = touch.clientX - this._moveOrigin.x;
        const dy = touch.clientY - this._moveOrigin.y;
        const dead = 14;
        this.right = dx > dead;
        this.left = dx < -dead;
        this.back = dy > dead;
        this.forward = dy < -dead;
      } else if (touch.identifier === this._lookTouchId) {
        const dx = touch.clientX - this._lookLast.x;
        const dy = touch.clientY - this._lookLast.y;
        this._lookLast = { x: touch.clientX, y: touch.clientY };
        this._lookTravel += Math.abs(dx) + Math.abs(dy);
        this.onLook?.(dx, dy, this.sensitivity * 1.7);
      }
    }
    e.preventDefault();
  }

  _onTouchEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._moveTouchId) {
        this._moveTouchId = null;
        this.forward = this.back = this.left = this.right = false;
      } else if (touch.identifier === this._lookTouchId) {
        this._lookTouchId = null;
        // A tap that did not pan the camera is a mining action.
        if (this._lookTravel <= CLICK_SLOP * 2) this.onAttackStart?.();
      }
    }
    e.preventDefault();
  }

  // Lets on-screen buttons drive the same flags the keyboard sets.
  bindButton(el, action) {
    if (!el) return;
    const start = (e) => {
      e.preventDefault();
      if (action === "jump") this.jump = true;
      else if (action === "sneak") this.sneak = true;
      else if (action === "place") this.onUseStart?.();
      else if (action === "mine") this.attacking = true;
      else this.onCommand?.(action);
    };
    const end = (e) => {
      e.preventDefault();
      if (action === "jump") this.jump = false;
      else if (action === "sneak") this.sneak = false;
      else if (action === "mine") this.attacking = false;
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    el.addEventListener("mousedown", start);
    el.addEventListener("mouseup", end);
    el.addEventListener("mouseleave", end);
  }
}
