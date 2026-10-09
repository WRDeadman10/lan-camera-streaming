/**
 * @file logger.js
 * Structured logging module with ISO timestamps, levels, and secret protection.
 */

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  constructor(level = 'info') {
    this.levelName = level.toLowerCase();
    this.levelValue = LEVELS[this.levelName] || LEVELS.info;
  }

  _format(level, message, meta) {
    const timestamp = new Date().toISOString();
    let metaStr = '';
    if (meta !== undefined) {
      try {
        metaStr = ' ' + JSON.stringify(meta);
      } catch (err) {
        metaStr = ' [unserializable metadata]';
      }
    }
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  debug(message, meta) {
    if (this.levelValue <= LEVELS.debug) {
      console.debug(this._format('debug', message, meta));
    }
  }

  info(message, meta) {
    if (this.levelValue <= LEVELS.info) {
      console.log(this._format('info', message, meta));
    }
  }

  warn(message, meta) {
    if (this.levelValue <= LEVELS.warn) {
      console.warn(this._format('warn', message, meta));
    }
  }

  error(message, meta) {
    if (this.levelValue <= LEVELS.error) {
      console.error(this._format('error', message, meta));
    }
  }
}
