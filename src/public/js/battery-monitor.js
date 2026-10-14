/**
 * @file battery-monitor.js
 * Device battery status monitor using the standard Battery Status API.
 * Provides real-time charge percentage, charging state, and update events.
 */

export class BatteryMonitor {
  constructor(onBatteryChange) {
    this.onBatteryChange = onBatteryChange;
    this.battery = null;
    this._handleLevelChange = this._handleUpdate.bind(this);
    this._handleChargingChange = this._handleUpdate.bind(this);
    this._init();
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function';
  }

  async _init() {
    if (!BatteryMonitor.isSupported()) {
      return;
    }

    try {
      this.battery = await navigator.getBattery();
      if (!this.battery) return;

      this.battery.addEventListener('levelchange', this._handleLevelChange);
      this.battery.addEventListener('chargingchange', this._handleChargingChange);
      this._handleUpdate();
    } catch (err) {
      console.warn('[BatteryMonitor] Failed to access Battery API:', err);
    }
  }

  _handleUpdate() {
    if (!this.battery) return;
    const data = this.getCurrent();
    if (data && typeof this.onBatteryChange === 'function') {
      this.onBatteryChange(data);
    }
  }

  getCurrent() {
    if (!this.battery) return null;
    return {
      level: Math.round(this.battery.level * 100),
      charging: Boolean(this.battery.charging),
      chargingTime: typeof this.battery.chargingTime === 'number' ? this.battery.chargingTime : null,
      dischargingTime: typeof this.battery.dischargingTime === 'number' ? this.battery.dischargingTime : null
    };
  }

  destroy() {
    if (this.battery) {
      try {
        this.battery.removeEventListener('levelchange', this._handleLevelChange);
        this.battery.removeEventListener('chargingchange', this._handleChargingChange);
      } catch (e) {
        // ignore
      }
      this.battery = null;
    }
  }
}
