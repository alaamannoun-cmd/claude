import { damp } from './noise.js';

const ACTIONS = {
  KeyB: 'bell',
  KeyC: 'camera',
  KeyT: 'time',
  KeyF: 'autopilot',
  KeyG: 'wave',
  KeyP: 'photo',
  KeyH: 'hud',
  KeyM: 'mute',
  KeyQ: 'quality',
  Escape: 'pause',
};

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.handlers = new Map();
    this.steer = 0;
    this.touch = { throttle: 0, brake: 0, steer: 0, active: false };
    this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat && ACTIONS[e.code]) this.emit(ACTIONS[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // drag to orbit the camera, wheel to zoom
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.emit('orbit', e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('pointercancel', () => (drag = null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.emit('zoom', e.deltaY);
      },
      { passive: false }
    );
    // two-finger orbit on touch screens (single touches go to the on-screen controls)
    let t2 = null;
    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 1) {
          const t = e.touches[0];
          if (t2) this.emit('orbit', (t.clientX - t2.x) * 1.4, (t.clientY - t2.y) * 1.4);
          t2 = { x: t.clientX, y: t.clientY };
        }
      },
      { passive: true }
    );
    canvas.addEventListener('touchend', () => (t2 = null), { passive: true });
  }

  on(action, fn) {
    if (!this.handlers.has(action)) this.handlers.set(action, []);
    this.handlers.get(action).push(fn);
  }

  emit(action, ...args) {
    for (const fn of this.handlers.get(action) || []) fn(...args);
  }

  // Bind the on-screen touch controls
  bindTouch(root) {
    const pad = root.querySelector('#steer-pad');
    const knob = root.querySelector('#steer-knob');
    let padId = null;
    const setSteer = (x) => {
      const r = pad.getBoundingClientRect();
      const v = Math.max(-1, Math.min(1, ((x - (r.left + r.width / 2)) / (r.width / 2)) * 1.2));
      this.touch.steer = -v;
      knob.style.transform = `translateX(${v * r.width * 0.32}px)`;
    };
    pad.addEventListener('pointerdown', (e) => {
      padId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      setSteer(e.clientX);
      this.touch.active = true;
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === padId) setSteer(e.clientX);
    });
    const endPad = (e) => {
      if (e.pointerId !== padId) return;
      padId = null;
      this.touch.steer = 0;
      knob.style.transform = '';
    };
    pad.addEventListener('pointerup', endPad);
    pad.addEventListener('pointercancel', endPad);
    const hold = (id, key) => {
      const el = root.querySelector(id);
      const on = (e) => {
        e.preventDefault();
        this.touch[key] = 1;
        el.classList.add('down');
        this.touch.active = true;
      };
      const off = () => {
        this.touch[key] = 0;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    hold('#btn-pedal', 'throttle');
    hold('#btn-brake', 'brake');
    root.querySelectorAll('[data-action]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.emit(el.dataset.action);
      })
    );
  }

  state(dt) {
    const k = this.keys;
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, sprint: false };
    const kThrottle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kBrake = k.has('KeyS') || k.has('ArrowDown') || k.has('Space') ? 1 : 0;
    let target = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) target += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) target -= 1;
    if (this.touch.steer !== 0) target = this.touch.steer;
    // ease keyboard steering in and out so turns feel smooth
    this.steer = damp(this.steer, target, target === 0 ? 7 : 4.5, dt);
    return {
      throttle: Math.max(kThrottle, this.touch.throttle),
      brake: Math.max(kBrake, this.touch.brake),
      steer: this.steer,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
  }
}
