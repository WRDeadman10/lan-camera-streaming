/**
 * @file chat.js
 * In-room real-time WhatsApp-style chat system.
 * Features:
 * - Auto-generated and persistent usernames in localStorage.
 * - Interactive display name editing with room notification.
 * - Persistent mute/unmute control.
 * - Slide-out/slide-in panel with floating action button and unread dot badge.
 * - WhatsApp-style incoming/outgoing bubbles, tails, timestamps, checkmarks, sender tags.
 * - Dimmed Unsplash background photo with obsidian overlay and instant shuffle.
 * - Synthesized Web Audio chime on incoming messages.
 */

export const STORAGE_KEY_USERNAME = 'lancam_chat_username';
export const STORAGE_KEY_MUTED = 'lancam_chat_muted';
export const STORAGE_KEY_BG_URL = 'lancam_chat_bg_url';
export const STORAGE_KEY_BG_DATE = 'lancam_chat_bg_date';
export const STORAGE_KEY_USER_ID = 'lancam_chat_user_id';

export const DEFAULT_UNSPLASH_CLIENT_ID = '15MDKvUVv4HMJ3DzyeRIwxCFvEB70QeNcKzOCX_Puf0';

export const FALLBACK_CHAT_WALLPAPERS = [
  'https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1080&q=80&auto=format&fit=crop', // Night sky & stars
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1080&q=80&auto=format&fit=crop', // Dark minimalist texture
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1080&q=80&auto=format&fit=crop', // Space nebula
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&q=80&auto=format&fit=crop'  // Deep calm sea
];

const CHAT_ADJECTIVES = [
  'Cosmic', 'Swift', 'Bright', 'Lunar', 'Solar', 'Silent', 'Nova', 'Cyber',
  'Stellar', 'Quantum', 'Echo', 'Neon', 'Velvet', 'Shadow', 'Crimson', 'Azure',
  'Mystic', 'Golden', 'Emerald', 'Vivid', 'Radiant', 'Turbo', 'Zenith', 'Prism'
];

const CHAT_NOUNS = [
  'Falcon', 'Fox', 'Eagle', 'Wolf', 'Panther', 'Pilot', 'Hawk', 'Otter',
  'Pioneer', 'Voyager', 'Phoenix', 'Comet', 'Rover', 'Specter', 'Viper', 'Lynx',
  'Explorer', 'Nomad', 'Beacon', 'Atlas', 'Ranger', 'Striker', 'Titan', 'Spark'
];

const SENDER_COLORS = [
  '#34b7f1', '#25d366', '#ffb86c', '#ff79c6',
  '#bd93f9', '#f1fa8c', '#50fa7b', '#ff7675',
  '#74b9ff', '#a29bfe', '#fab1a0', '#00cec9'
];

/**
 * Generates an automated friendly nickname.
 * @param {string} [role]
 * @returns {string}
 */
export function generateAutoName(role = 'viewer') {
  const adj = CHAT_ADJECTIVES[Math.floor(Math.random() * CHAT_ADJECTIVES.length)];
  const noun = CHAT_NOUNS[Math.floor(Math.random() * CHAT_NOUNS.length)];
  const num = Math.floor(100 + Math.random() * 900);
  if (role === 'sender') {
    return `Streamer ${noun} ${num}`;
  }
  return `${adj} ${noun} ${num}`;
}

/**
 * Retrieves the stored username from localStorage or creates and persists a new one.
 * @param {string} [role]
 * @returns {string}
 */
export function getStoredUsername(role = 'viewer') {
  if (typeof window === 'undefined' || !window.localStorage) {
    return generateAutoName(role);
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_USERNAME);
    if (stored && typeof stored === 'string' && stored.trim().length > 0) {
      return stored.trim().slice(0, 32);
    }
    const autoName = generateAutoName(role);
    window.localStorage.setItem(STORAGE_KEY_USERNAME, autoName);
    return autoName;
  } catch (err) {
    return generateAutoName(role);
  }
}

/**
 * Persists the username in localStorage.
 * @param {string} newName
 * @returns {string}
 */
export function setStoredUsername(newName) {
  const clean = typeof newName === 'string' ? newName.trim().slice(0, 32) : '';
  if (!clean) {
    return getStoredUsername();
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY_USERNAME, clean);
    } catch (err) {}
  }
  return clean;
}

/**
 * Retrieves or generates and persists a unique client user identifier.
 * Ensures the same user retains identity for their own messages across socket reconnects.
 * @returns {string}
 */
export function getOrCreateUserId() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY_USER_ID);
    if (existing && typeof existing === 'string' && existing.trim().length > 0) {
      return existing.trim();
    }
    const newId = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(STORAGE_KEY_USER_ID, newId);
    return newId;
  } catch (err) {
    return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Retrieves mute preference from localStorage.
 * @returns {boolean}
 */
export function getStoredMuteState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY_MUTED) === 'true';
  } catch (err) {
    return false;
  }
}

/**
 * Persists mute preference in localStorage.
 * @param {boolean} isMuted
 */
export function setStoredMuteState(isMuted) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY_MUTED, isMuted ? 'true' : 'false');
    } catch (err) {}
  }
}

/**
 * Derives a consistent WhatsApp-like accent color for a sender name.
 * @param {string} name
 * @returns {string}
 */
export function getSenderColor(name) {
  if (!name) return SENDER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % SENDER_COLORS.length;
  return SENDER_COLORS[idx];
}

/**
 * Formats a unix timestamp into HH:MM.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatTime(timestamp) {
  const d = new Date(timestamp || Date.now());
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * ChatManager class managing in-room chat UI, socket events, and Unsplash backgrounds.
 */
export class ChatManager {
  constructor() {
    this.socket = null;
    this.roomId = null;
    this.role = 'viewer';
    this.userId = getOrCreateUserId();
    this.username = getStoredUsername('viewer');
    this.isMuted = getStoredMuteState();
    this.isOpen = false;
    this.unreadCount = 0;
    this.messages = [];
    this.renderedMessageIds = new Set();
    this.audioCtx = null;
    this.wallpaperUrl = null;

    this.elements = {};
    this.bound = false;
    this._onChatMessage = null;
    this._onChatSystem = null;
  }

  /**
   * Initializes DOM elements and event bindings.
   */
  init() {
    if (typeof document === 'undefined') {
      return;
    }
    if (document.getElementById('chatFloatingBtn')) {
      return;
    }

    this.createDomElements();
    this.attachDomListeners();
    this.setupSwipeToDismiss();
    this.setupMobileViewport();
    this.loadInitialWallpaper();
    this.updateMuteButtonUi();
  }

  /**
   * Sets the active Socket.IO connection.
   * @param {object} socket
   */
  setSocket(socket) {
    if (!socket || this.socket === socket) {
      return;
    }
    this.detachSocketListeners();
    this.socket = socket;
    this.attachSocketListeners();
  }

  /**
   * Configures active room details.
   * @param {string} roomId
   * @param {string} [role]
   */
  setRoom(roomId, role = 'viewer') {
    const isNewRoom = this.roomId !== roomId;
    if (isNewRoom) {
      this.clearMessages();
    }
    this.roomId = roomId;
    this.role = role;
    if (this.elements.roomTitle) {
      this.elements.roomTitle.textContent = roomId ? `Room Chat: ${roomId}` : 'Room Chat';
    }
    if (this.elements.roomSub) {
      this.elements.roomSub.textContent = roomId ? 'Active Room' : 'Not Connected';
    }
    if (this.elements.input) {
      this.elements.input.disabled = !roomId;
      this.elements.input.placeholder = roomId ? 'Type a message...' : 'Connect to a room to chat...';
    }
    if (this.elements.sendBtn) {
      this.elements.sendBtn.disabled = !roomId;
    }

    if (this.socket && roomId) {
      this.socket.emit('chat:history', { roomId }, (res) => {
        if (res && res.success && Array.isArray(res.messages)) {
          this.renderHistory(res.messages);
        }
      });
    }
  }

  /**
   * Resets message history and rendered DOM bubbles.
   */
  clearMessages() {
    this.messages = [];
    this.renderedMessageIds.clear();
    this.unreadCount = 0;
    this.updateUnreadBadge();
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.innerHTML = `
        <div class="chat-bubble system">
          <span>🔒 Messages are room-scoped and encrypted over your streaming session.</span>
        </div>
      `;
    }
  }

  /**
   * Constructs the WhatsApp chat UI and floating button in the document.
   */
  createDomElements() {
    // 1. Floating Toggle Button with Unread Dot Badge
    const floatBtn = document.createElement('button');
    floatBtn.id = 'chatFloatingBtn';
    floatBtn.type = 'button';
    floatBtn.className = 'chat-floating-btn';
    floatBtn.setAttribute('aria-label', 'Open Room Chat');
    floatBtn.title = 'Open Room Chat';
    floatBtn.innerHTML = `
      <svg class="chat-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <span id="chatUnreadBadge" class="chat-unread-badge" style="display: none;">0</span>
    `;
    document.body.appendChild(floatBtn);

    // 2. Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'chatBackdrop';
    backdrop.className = 'chat-backdrop';
    document.body.appendChild(backdrop);

    // 3. Slide-Out Drawer
    const drawer = document.createElement('aside');
    drawer.id = 'chatDrawer';
    drawer.className = 'chat-drawer';
    drawer.setAttribute('aria-label', 'Room Chat');
    drawer.innerHTML = `
      <!-- WhatsApp-style Header -->
      <div class="chat-header">
        <div class="chat-avatar-circle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div class="chat-header-info">
          <div id="chatRoomTitle" class="chat-room-title">Room Chat</div>
          <div id="chatRoomSub" class="chat-room-sub">Not Connected</div>
        </div>
        <div class="chat-header-actions">
          <button type="button" id="btnChatShuffleBg" class="chat-header-btn" title="Shuffle Background Photo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <button type="button" id="btnChatMute" class="chat-header-btn" title="Mute Notifications">
            <svg id="iconChatUnmuted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <svg id="iconChatMuted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
              <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
              <path d="M18 8a6 6 0 0 0-9.33-5"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
          <button type="button" id="btnChatClose" class="chat-header-btn chat-close-btn" title="Close Chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Identity Strip -->
      <div class="chat-identity-strip">
        <span class="chat-identity-label">You:</span>
        <span id="chatDisplayUsername" class="chat-identity-name">${escapeHtml(this.username)}</span>
        <button type="button" id="btnChatEditName" class="btn-ghost-sm" title="Edit your name">Change</button>
      </div>

      <!-- Inline Name Edit Bar -->
      <div id="chatNameEditBar" class="chat-name-edit-bar" style="display: none;">
        <input type="text" id="chatNameInput" class="chat-name-input" maxlength="32" placeholder="Your display name">
        <button type="button" id="btnChatSaveName" class="btn btn-primary btn-sm">Save</button>
        <button type="button" id="btnChatCancelName" class="btn btn-secondary btn-sm">Cancel</button>
      </div>

      <!-- Chat Body with Dimmed Unsplash Background Layer -->
      <div class="chat-body" id="chatBody">
        <div id="chatBgImage" class="chat-bg-image"></div>
        <div class="chat-bg-overlay"></div>
        <div id="chatMessages" class="chat-messages" role="log" aria-live="polite">
          <div class="chat-bubble system">
            <span>🔒 Messages are room-scoped and encrypted over your streaming session.</span>
          </div>
        </div>
      </div>

      <!-- WhatsApp-style Input Footer -->
      <form id="chatForm" class="chat-footer">
        <div class="chat-input-wrapper">
          <input type="text" id="chatInput" class="chat-input" placeholder="Connect to a room to chat..." maxlength="2000" disabled autocomplete="off">
        </div>
        <button type="submit" id="btnChatSend" class="chat-send-btn" title="Send message" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </form>
    `;
    document.body.appendChild(drawer);

    // Cache elements
    this.elements = {
      floatBtn,
      unreadBadge: document.getElementById('chatUnreadBadge'),
      backdrop,
      drawer,
      roomTitle: document.getElementById('chatRoomTitle'),
      roomSub: document.getElementById('chatRoomSub'),
      btnMute: document.getElementById('btnChatMute'),
      iconUnmuted: document.getElementById('iconChatUnmuted'),
      iconMuted: document.getElementById('iconChatMuted'),
      btnClose: document.getElementById('btnChatClose'),
      btnShuffleBg: document.getElementById('btnChatShuffleBg'),
      displayUsername: document.getElementById('chatDisplayUsername'),
      btnEditName: document.getElementById('btnChatEditName'),
      nameEditBar: document.getElementById('chatNameEditBar'),
      nameInput: document.getElementById('chatNameInput'),
      btnSaveName: document.getElementById('btnChatSaveName'),
      btnCancelName: document.getElementById('btnChatCancelName'),
      bgImage: document.getElementById('chatBgImage'),
      messagesContainer: document.getElementById('chatMessages'),
      form: document.getElementById('chatForm'),
      input: document.getElementById('chatInput'),
      sendBtn: document.getElementById('btnChatSend')
    };
  }

  /**
   * Attaches click and submit event listeners to DOM controls.
   */
  attachDomListeners() {
    this.elements.floatBtn.addEventListener('click', () => this.toggleDrawer());
    this.elements.backdrop.addEventListener('click', () => this.toggleDrawer(false));
    this.elements.btnClose.addEventListener('click', () => this.toggleDrawer(false));

    this.elements.btnMute.addEventListener('click', () => this.toggleMute());
    this.elements.btnShuffleBg.addEventListener('click', () => this.shuffleWallpaper());

    // Display Name Editing
    this.elements.btnEditName.addEventListener('click', () => {
      this.elements.nameInput.value = this.username;
      this.elements.nameEditBar.style.display = 'flex';
      this.elements.nameInput.focus();
    });

    this.elements.btnCancelName.addEventListener('click', () => {
      this.elements.nameEditBar.style.display = 'none';
    });

    this.elements.btnSaveName.addEventListener('click', () => this.saveEditedName());
    this.elements.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveEditedName();
      } else if (e.key === 'Escape') {
        this.elements.nameEditBar.style.display = 'none';
      }
    });

    // Message Form
    this.elements.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitMessage();
    });

    // Keyboard navigation: Escape key closes drawer
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.toggleDrawer(false);
      }
    });
  }

  /**
   * Detaches previously registered Socket.IO listeners to avoid duplicates.
   */
  detachSocketListeners() {
    if (!this.socket) {
      return;
    }
    if (this._onChatMessage) {
      if (typeof this.socket.off === 'function') {
        this.socket.off('chat:message', this._onChatMessage);
      }
      this._onChatMessage = null;
    }
    if (this._onChatSystem) {
      if (typeof this.socket.off === 'function') {
        this.socket.off('chat:system', this._onChatSystem);
      }
      this._onChatSystem = null;
    }
  }

  /**
   * Attaches Socket.IO listeners for real-time messaging.
   */
  attachSocketListeners() {
    if (!this.socket) {
      return;
    }
    this.detachSocketListeners();
    this._onChatMessage = (message) => {
      this.appendMessage(message);
    };
    this._onChatSystem = (sysMessage) => {
      this.appendSystemMessage(sysMessage);
    };
    this.socket.on('chat:message', this._onChatMessage);
    this.socket.on('chat:system', this._onChatSystem);
  }

  /**
   * Saves and broadcasts a modified username.
   */
  saveEditedName() {
    const raw = this.elements.nameInput.value;
    const clean = raw.trim().slice(0, 32);
    if (!clean) {
      return;
    }
    const oldName = this.username;
    this.username = setStoredUsername(clean);
    this.elements.displayUsername.textContent = this.username;
    this.elements.nameEditBar.style.display = 'none';

    if (this.socket && this.roomId && oldName !== this.username) {
      this.socket.emit('chat:name-change', {
        roomId: this.roomId,
        oldName,
        newName: this.username
      });
    }
  }

  /**
   * Toggles drawer panel visibility.
   * @param {boolean} [forceState]
   */
  toggleDrawer(forceState) {
    this.isOpen = typeof forceState === 'boolean' ? forceState : !this.isOpen;

    if (this.isOpen) {
      this.elements.drawer.classList.add('open');
      this.elements.backdrop.classList.add('open');
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('chat-drawer-open');
      }
      this.unreadCount = 0;
      this.updateUnreadBadge();
      this.scrollToBottom();
      setTimeout(() => {
        if (this.elements.input && !this.elements.input.disabled) {
          this.elements.input.focus();
        }
      }, 200);
    } else {
      this.elements.drawer.classList.remove('open');
      this.elements.backdrop.classList.remove('open');
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('chat-drawer-open');
      }
      this.elements.nameEditBar.style.display = 'none';
      this.resetMobileKeyboardOffset();
    }
  }

  /**
   * Configures touch gestures for swiping right to dismiss the drawer on mobile.
   */
  setupSwipeToDismiss() {
    if (!this.elements.drawer) {
      return;
    }
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isTracking = false;

    this.elements.drawer.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentX = startX;
        isTracking = true;
      }
    }, { passive: true });

    this.elements.drawer.addEventListener('touchmove', (e) => {
      if (!isTracking || !e.touches || e.touches.length !== 1) {
        return;
      }
      currentX = e.touches[0].clientX;
      const deltaX = currentX - startX;
      const deltaY = Math.abs(e.touches[0].clientY - startY);

      if (deltaX > 15 && deltaX > deltaY) {
        this.elements.drawer.style.transform = `translateX(${deltaX}px)`;
      }
    }, { passive: true });

    const handleTouchEnd = () => {
      if (!isTracking) {
        return;
      }
      isTracking = false;
      const deltaX = currentX - startX;
      this.elements.drawer.style.transform = '';
      if (deltaX > 75) {
        this.toggleDrawer(false);
      }
    };

    this.elements.drawer.addEventListener('touchend', handleTouchEnd, { passive: true });
    this.elements.drawer.addEventListener('touchcancel', handleTouchEnd, { passive: true });
  }

  /**
   * Adapts drawer height and offset when mobile virtual keyboard opens via VisualViewport API.
   */
  setupMobileViewport() {
    if (typeof window === 'undefined') {
      return;
    }

    if (window.visualViewport) {
      const onViewportChange = () => {
        if (!this.isOpen || !this.elements.drawer) {
          return;
        }
        const vv = window.visualViewport;
        const heightDiff = window.innerHeight - vv.height;
        if (heightDiff > 80) {
          this.elements.drawer.style.height = `${vv.height}px`;
          this.elements.drawer.style.top = `${vv.offsetTop}px`;
          this.scrollToBottom();
        } else {
          this.resetMobileKeyboardOffset();
        }
      };

      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }

    window.addEventListener('orientationchange', () => {
      this.resetMobileKeyboardOffset();
      setTimeout(() => this.scrollToBottom(), 300);
    });
  }

  /**
   * Resets any dynamic keyboard height/offset styles.
   */
  resetMobileKeyboardOffset() {
    if (this.elements.drawer) {
      this.elements.drawer.style.height = '';
      this.elements.drawer.style.top = '';
    }
  }

  /**
   * Toggles mute notifications state and updates UI.
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    setStoredMuteState(this.isMuted);
    this.updateMuteButtonUi();
  }

  /**
   * Updates mute toggle icon and tooltip.
   */
  updateMuteButtonUi() {
    if (this.isMuted) {
      this.elements.iconUnmuted.style.display = 'none';
      this.elements.iconMuted.style.display = 'block';
      this.elements.btnMute.title = 'Unmute Notifications';
      this.elements.btnMute.classList.add('is-muted');
    } else {
      this.elements.iconUnmuted.style.display = 'block';
      this.elements.iconMuted.style.display = 'none';
      this.elements.btnMute.title = 'Mute Notifications';
      this.elements.btnMute.classList.remove('is-muted');
    }
  }

  /**
   * Updates unread indicator badge and dot on floating button.
   */
  updateUnreadBadge() {
    if (!this.elements.unreadBadge) {
      return;
    }
    if (this.unreadCount > 0 && !this.isOpen) {
      this.elements.unreadBadge.style.display = 'flex';
      this.elements.unreadBadge.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount);
      this.elements.floatBtn.classList.add('has-unread');
    } else {
      this.elements.unreadBadge.style.display = 'none';
      this.elements.floatBtn.classList.remove('has-unread');
    }
  }

  /**
   * Submits a new text message.
   */
  submitMessage() {
    const raw = this.elements.input.value;
    const clean = raw.trim();
    if (!clean || !this.socket || !this.roomId) {
      return;
    }

    const payload = {
      roomId: this.roomId,
      text: clean,
      senderName: this.username,
      senderUserId: this.userId
    };

    this.elements.input.value = '';
    this.elements.sendBtn.disabled = true;

    this.socket.emit('chat:message', payload, (res) => {
      this.elements.sendBtn.disabled = false;
      this.elements.input.focus();
    });
  }

  /**
   * Renders incoming or outgoing chat message.
   * Deduplicates messages to prevent re-rendering when rejoining or reloading history.
   * @param {object} msg
   * @param {boolean} [isHistory=false]
   */
  appendMessage(msg, isHistory = false) {
    if (!msg || typeof msg !== 'object') {
      return;
    }

    const msgId = msg.id || (msg.text && msg.timestamp ? `msg_${msg.timestamp}_${msg.senderId || ''}` : null);
    if (msgId) {
      if (this.renderedMessageIds.has(msgId)) {
        return;
      }
      if (this.elements.messagesContainer && document.getElementById(msgId)) {
        this.renderedMessageIds.add(msgId);
        return;
      }
      this.renderedMessageIds.add(msgId);
    }

    const isSelf = Boolean(
      (msg.senderUserId && this.userId && msg.senderUserId === this.userId) ||
      (this.socket && msg.senderId && msg.senderId === this.socket.id)
    );

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'outgoing' : 'incoming'}`;
    if (msgId) {
      bubble.id = msgId;
    }

    const senderColor = getSenderColor(msg.senderName);
    const timeFormatted = formatTime(msg.timestamp);

    let html = '';
    if (!isSelf) {
      html += `<div class="chat-bubble-sender" style="color: ${senderColor};">${escapeHtml(msg.senderName || 'Viewer')}</div>`;
    }
    html += `<div class="chat-bubble-text">${escapeHtml(msg.text)}</div>`;
    html += `
      <div class="chat-bubble-meta">
        <span class="chat-bubble-time">${timeFormatted}</span>
        ${isSelf ? '<span class="chat-checkmarks" title="Delivered">✓✓</span>' : ''}
      </div>
    `;

    bubble.innerHTML = html;
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.appendChild(bubble);
    }
    this.scrollToBottom();

    if (!isSelf && !isHistory) {
      if (!this.isOpen) {
        this.unreadCount++;
        this.updateUnreadBadge();
        if (!this.isMuted) {
          this.playNotificationSound();
        }
      }
    }
  }

  /**
   * Appends system informational chip to the chat stream.
   * Deduplicates system messages by ID to prevent repeating announcements.
   * @param {object} sysMsg
   * @param {boolean} [isHistory=false]
   */
  appendSystemMessage(sysMsg, isHistory = false) {
    if (!sysMsg || !sysMsg.text) {
      return;
    }
    const sysId = sysMsg.id || `sys_${sysMsg.timestamp || ''}_${encodeURIComponent(sysMsg.text)}`;
    if (this.renderedMessageIds.has(sysId)) {
      return;
    }
    if (this.elements.messagesContainer && document.getElementById(sysId)) {
      this.renderedMessageIds.add(sysId);
      return;
    }
    this.renderedMessageIds.add(sysId);

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble system';
    bubble.id = sysId;
    bubble.innerHTML = `<span>${escapeHtml(sysMsg.text)}</span>`;
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.appendChild(bubble);
    }
    this.scrollToBottom();
  }

  /**
   * Renders loaded history items.
   * @param {Array<object>} messages
   */
  renderHistory(messages) {
    if (!Array.isArray(messages)) {
      return;
    }
    for (const msg of messages) {
      if (msg.isSystem) {
        this.appendSystemMessage(msg, true);
      } else {
        this.appendMessage(msg, true);
      }
    }
  }

  /**
   * Smoothly scrolls message viewport to the latest entry.
   */
  scrollToBottom() {
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    }
  }

  /**
   * Plays a pleasant dual-tone synthesized notification chime via Web Audio.
   */
  playNotificationSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return;
      }
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      const now = this.audioCtx.currentTime;

      // Tone 1: 520 Hz
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(520, now);
      gain1.gain.setValueAtTime(0.08, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      // Tone 2: 680 Hz
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(680, now + 0.08);
      gain2.gain.setValueAtTime(0.09, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.22);
    } catch (err) {
      // Audio playback fails silently if browser policy blocks autoplay before interaction
    }
  }

  /**
   * Loads initial Unsplash wallpaper or fallback.
   */
  loadInitialWallpaper() {
    let cachedUrl = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        cachedUrl = window.localStorage.getItem(STORAGE_KEY_BG_URL);
      } catch (err) {}
    }
    const initialUrl = cachedUrl || FALLBACK_CHAT_WALLPAPERS[0];
    this.applyWallpaper(initialUrl);

    if (!cachedUrl) {
      this.shuffleWallpaper();
    }
  }

  /**
   * Shuffles and fetches a new random photo from Unsplash.
   */
  async shuffleWallpaper() {
    try {
      const endpoint = `https://api.unsplash.com/photos/random?query=nature,texture,dark,minimal,night&orientation=portrait&client_id=${DEFAULT_UNSPLASH_CLIENT_ID}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Unsplash status ${res.status}`);
      }
      const data = await res.json();
      const candidate = data.urls?.raw || data.urls?.full || data.urls?.regular;
      if (!candidate) {
        throw new Error('No candidate URL in Unsplash response');
      }

      const optimized = candidate.includes('images.unsplash.com') && candidate.includes('?')
        ? `${candidate}&w=1080&q=80&auto=format&fit=crop`
        : candidate;

      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(STORAGE_KEY_BG_URL, optimized);
        } catch (err) {}
      }
      this.applyWallpaper(optimized);
    } catch (err) {
      // Graceful fallback to rotating preset
      const nextFallback = FALLBACK_CHAT_WALLPAPERS[Math.floor(Math.random() * FALLBACK_CHAT_WALLPAPERS.length)];
      this.applyWallpaper(nextFallback);
    }
  }

  /**
   * Applies the background image URL to the chat wallpaper container.
   * @param {string} url
   */
  applyWallpaper(url) {
    if (!this.elements.bgImage || !url) {
      return;
    }
    this.wallpaperUrl = url;
    this.elements.bgImage.style.backgroundImage = `url("${url}")`;
  }
}

/**
 * Escapes HTML characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let globalChatManager = null;

/**
 * Returns the singleton ChatManager instance, creating and initializing it if needed.
 * @returns {ChatManager}
 */
export function getChatManager() {
  if (!globalChatManager) {
    globalChatManager = new ChatManager();
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => globalChatManager.init());
      } else {
        globalChatManager.init();
      }
    }
  }
  return globalChatManager;
}

// Auto-instantiate on script load in browser
if (typeof window !== 'undefined') {
  window.getChatManager = getChatManager;
  getChatManager();
}
