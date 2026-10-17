import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  generateAutoName,
  getStoredUsername,
  setStoredUsername,
  getStoredMuteState,
  setStoredMuteState,
  getSenderColor,
  formatTime,
  ChatManager,
  STORAGE_KEY_USERNAME,
  STORAGE_KEY_MUTED,
  STORAGE_KEY_BG_URL,
  STORAGE_KEY_USER_ID,
  getOrCreateUserId
} from '../src/public/js/chat.js';

describe('In-Room WhatsApp-Style Chat UI & Persistence', () => {
  let dom;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
      url: 'http://localhost/viewer'
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.localStorage.clear();
  });

  test('generateAutoName creates valid nickname strings', () => {
    const viewerName = generateAutoName('viewer');
    assert.match(viewerName, /^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/);

    const streamerName = generateAutoName('sender');
    assert.match(streamerName, /^Streamer [A-Z][a-z]+ \d{3}$/);
  });

  test('Username persists in localStorage and can be edited', () => {
    // Initial fetch generates and caches an auto name
    const initial = getStoredUsername('viewer');
    assert.ok(initial);
    assert.equal(global.localStorage.getItem(STORAGE_KEY_USERNAME), initial);

    // Re-reading retrieves the exact same cached name
    const second = getStoredUsername('viewer');
    assert.equal(second, initial);

    // Editing username updates localStorage
    const custom = setStoredUsername('Commander Shepard');
    assert.equal(custom, 'Commander Shepard');
    assert.equal(global.localStorage.getItem(STORAGE_KEY_USERNAME), 'Commander Shepard');
    assert.equal(getStoredUsername(), 'Commander Shepard');
  });

  test('Mute state persists in localStorage', () => {
    assert.equal(getStoredMuteState(), false);

    setStoredMuteState(true);
    assert.equal(getStoredMuteState(), true);
    assert.equal(global.localStorage.getItem(STORAGE_KEY_MUTED), 'true');

    setStoredMuteState(false);
    assert.equal(getStoredMuteState(), false);
    assert.equal(global.localStorage.getItem(STORAGE_KEY_MUTED), 'false');
  });

  test('getSenderColor returns deterministic consistent accent color', () => {
    const colorA1 = getSenderColor('Alice');
    const colorA2 = getSenderColor('Alice');
    const colorB = getSenderColor('Bob');

    assert.equal(colorA1, colorA2);
    assert.match(colorA1, /^#[0-9a-f]{6}$/i);
    assert.match(colorB, /^#[0-9a-f]{6}$/i);
  });

  test('formatTime formats timestamps into HH:MM', () => {
    const timestamp = new Date(2026, 9, 18, 14, 5).getTime();
    assert.equal(formatTime(timestamp), '14:05');
  });

  test('ChatManager builds DOM with floating button, drawer, and dimmed background', () => {
    const chat = new ChatManager();
    chat.init();

    const floatBtn = document.getElementById('chatFloatingBtn');
    assert.ok(floatBtn, 'Floating action button must exist');

    const unreadBadge = document.getElementById('chatUnreadBadge');
    assert.ok(unreadBadge, 'Unread badge must exist');
    assert.equal(unreadBadge.style.display, 'none');

    const drawer = document.getElementById('chatDrawer');
    assert.ok(drawer, 'Drawer must exist');
    assert.equal(drawer.classList.contains('open'), false);

    const roomTitle = document.getElementById('chatRoomTitle');
    assert.ok(roomTitle);

    const bgImage = document.getElementById('chatBgImage');
    assert.ok(bgImage, 'Background image layer must exist');

    const messages = document.getElementById('chatMessages');
    assert.ok(messages, 'Messages container must exist');

    const input = document.getElementById('chatInput');
    assert.ok(input, 'Input field must exist');
    assert.equal(input.disabled, true, 'Input must be disabled before room is joined');
  });

  test('Configuring room enables input and updates room title', () => {
    const chat = new ChatManager();
    chat.init();

    chat.setRoom('alpha-room', 'viewer');
    assert.equal(chat.elements.roomTitle.textContent, 'Room Chat: alpha-room');
    assert.equal(chat.elements.input.disabled, false);
    assert.equal(chat.elements.input.placeholder, 'Type a message...');
  });

  test('Drawer toggle controls visibility and clears unread count', () => {
    const chat = new ChatManager();
    chat.init();

    chat.unreadCount = 3;
    chat.updateUnreadBadge();
    assert.equal(chat.elements.unreadBadge.style.display, 'flex');
    assert.equal(chat.elements.unreadBadge.textContent, '3');

    // Open drawer
    chat.toggleDrawer(true);
    assert.equal(chat.isOpen, true);
    assert.equal(chat.elements.drawer.classList.contains('open'), true);
    assert.equal(chat.unreadCount, 0);
    assert.equal(chat.elements.unreadBadge.style.display, 'none');

    // Close drawer
    chat.toggleDrawer(false);
    assert.equal(chat.isOpen, false);
    assert.equal(chat.elements.drawer.classList.contains('open'), false);
  });

  test('Incoming messages increment unread count when drawer is closed', () => {
    const chat = new ChatManager();
    chat.init();

    // Mock incoming message from another peer
    chat.appendMessage({
      id: 'msg_test_1',
      senderId: 'sock_other',
      senderName: 'Echo Pilot 123',
      text: 'Can you see my screen?',
      timestamp: Date.now()
    });

    assert.equal(chat.unreadCount, 1);
    assert.equal(chat.elements.unreadBadge.style.display, 'flex');
    assert.equal(chat.elements.unreadBadge.textContent, '1');

    const rendered = document.getElementById('msg_test_1');
    assert.ok(rendered);
    assert.equal(rendered.classList.contains('incoming'), true);
    assert.match(rendered.textContent, /Echo Pilot 123/);
    assert.match(rendered.textContent, /Can you see my screen\?/);
  });

  test('Outgoing message renders as WhatsApp green bubble with checkmarks', () => {
    const chat = new ChatManager();
    chat.init();
    chat.socket = { id: 'sock_self' };

    chat.appendMessage({
      id: 'msg_self_1',
      senderId: 'sock_self',
      senderName: 'Myself',
      text: 'Yes, 1080p looks crystal clear!',
      timestamp: Date.now()
    });

    const rendered = document.getElementById('msg_self_1');
    assert.ok(rendered);
    assert.equal(rendered.classList.contains('outgoing'), true);
    assert.match(rendered.textContent, /Yes, 1080p looks crystal clear!/);
    assert.match(rendered.innerHTML, /✓✓/);
  });

  test('Mute button toggles state, updates icon and persists to localStorage', () => {
    const chat = new ChatManager();
    chat.init();

    assert.equal(chat.isMuted, false);
    chat.toggleMute();
    assert.equal(chat.isMuted, true);
    assert.equal(global.localStorage.getItem(STORAGE_KEY_MUTED), 'true');
    assert.equal(chat.elements.btnMute.title, 'Unmute Notifications');

    chat.toggleMute();
    assert.equal(chat.isMuted, false);
    assert.equal(global.localStorage.getItem(STORAGE_KEY_MUTED), 'false');
    assert.equal(chat.elements.btnMute.title, 'Mute Notifications');
  });

  test('Inline name editing updates display name and localStorage', () => {
    const chat = new ChatManager();
    chat.init();

    chat.elements.nameInput.value = 'Captain Falcon';
    chat.saveEditedName();

    assert.equal(chat.username, 'Captain Falcon');
    assert.equal(chat.elements.displayUsername.textContent, 'Captain Falcon');
    assert.equal(global.localStorage.getItem(STORAGE_KEY_USERNAME), 'Captain Falcon');
  });

  test('Drawer open/close toggles chat-drawer-open class on body for scroll locking', () => {
    const chat = new ChatManager();
    chat.init();

    assert.equal(document.body.classList.contains('chat-drawer-open'), false);

    chat.toggleDrawer(true);
    assert.equal(document.body.classList.contains('chat-drawer-open'), true);

    chat.toggleDrawer(false);
    assert.equal(document.body.classList.contains('chat-drawer-open'), false);
  });

  test('Touch swipe-to-dismiss closes drawer on horizontal right swipe', () => {
    const chat = new ChatManager();
    chat.init();

    chat.toggleDrawer(true);
    assert.equal(chat.isOpen, true);

    // Simulate rightward swipe gesture (deltaX = 120px)
    const touchStartEv = new dom.window.TouchEvent('touchstart', {
      touches: [{ clientX: 30, clientY: 150 }]
    });
    chat.elements.drawer.dispatchEvent(touchStartEv);

    const touchMoveEv = new dom.window.TouchEvent('touchmove', {
      touches: [{ clientX: 160, clientY: 155 }]
    });
    chat.elements.drawer.dispatchEvent(touchMoveEv);

    const touchEndEv = new dom.window.TouchEvent('touchend', {});
    chat.elements.drawer.dispatchEvent(touchEndEv);

    assert.equal(chat.isOpen, false, 'Horizontal swipe right must close the drawer');
    assert.equal(document.body.classList.contains('chat-drawer-open'), false);
  });

  test('resetMobileKeyboardOffset restores drawer height and top offset', () => {
    const chat = new ChatManager();
    chat.init();

    chat.elements.drawer.style.height = '420px';
    chat.elements.drawer.style.top = '80px';

    chat.resetMobileKeyboardOffset();

    assert.equal(chat.elements.drawer.style.height, '');
    assert.equal(chat.elements.drawer.style.top, '');
  });

  test('getOrCreateUserId generates and persists unique identifier in localStorage', () => {
    const userId1 = getOrCreateUserId();
    assert.ok(userId1.startsWith('user_'));
    assert.equal(global.localStorage.getItem(STORAGE_KEY_USER_ID), userId1);

    // Subsequent retrieval returns the same cached ID
    const userId2 = getOrCreateUserId();
    assert.equal(userId2, userId1);
  });

  test('appendMessage deduplicates messages and ignores duplicates with identical id', () => {
    const chat = new ChatManager();
    chat.init();

    const msg = {
      id: 'msg_unique_101',
      senderId: 'sock_other',
      senderName: 'Cosmic Fox 101',
      text: 'First arrival',
      timestamp: Date.now()
    };

    chat.appendMessage(msg);
    assert.equal(chat.unreadCount, 1);

    const bubblesBefore = chat.elements.messagesContainer.querySelectorAll('.chat-bubble.incoming');
    assert.equal(bubblesBefore.length, 1);

    // Call appendMessage again with the identical msg.id
    chat.appendMessage(msg);

    const bubblesAfter = chat.elements.messagesContainer.querySelectorAll('.chat-bubble.incoming');
    assert.equal(bubblesAfter.length, 1, 'Duplicate message must not create a second DOM bubble');
    assert.equal(chat.unreadCount, 1, 'Duplicate message must not increment unreadCount again');
  });

  test('renderHistory deduplicates messages when rejoining the room', () => {
    const chat = new ChatManager();
    chat.init();

    const historyMessages = [
      { id: 'm1', text: 'Hello', senderName: 'Alice', timestamp: 1000 },
      { id: 'm2', text: 'Hi', senderName: 'Bob', timestamp: 2000 }
    ];

    // Initial history load
    chat.renderHistory(historyMessages);
    let bubbles = chat.elements.messagesContainer.querySelectorAll('.chat-bubble:not(.system)');
    assert.equal(bubbles.length, 2);

    // Rejoin: history loaded a second time
    chat.renderHistory(historyMessages);
    bubbles = chat.elements.messagesContainer.querySelectorAll('.chat-bubble:not(.system)');
    assert.equal(bubbles.length, 2, 'Rejoining room must not duplicate rendered messages');
  });

  test('Past messages sent by this client remain outgoing green bubbles across socket reconnects via senderUserId', () => {
    const chat = new ChatManager();
    chat.init();

    // Client user has chat.userId and initially socket A
    chat.socket = { id: 'socket_A' };

    const ownMessage = {
      id: 'm_own_1',
      senderId: 'socket_A',
      senderUserId: chat.userId,
      senderName: chat.username,
      text: 'This is my original message',
      timestamp: 3000
    };

    chat.appendMessage(ownMessage);
    const bubble1 = document.getElementById('m_own_1');
    assert.ok(bubble1.classList.contains('outgoing'));

    // Socket reconnects! New socket ID is socket_B
    chat.socket = { id: 'socket_B' };

    // A message from this user sent with socket_A renders as outgoing because senderUserId matches
    chat.appendMessage({
      id: 'm_own_2',
      senderId: 'socket_A',
      senderUserId: chat.userId,
      senderName: chat.username,
      text: 'Message received in history',
      timestamp: 4000
    });
    const bubble2 = document.getElementById('m_own_2');
    assert.ok(bubble2.classList.contains('outgoing'));
    assert.equal(bubble2.classList.contains('incoming'), false);

    // Simulate page refresh / tab rejoin where localStorage persists userId
    document.body.innerHTML = '<div id="app"></div>';
    const chat2 = new ChatManager();
    chat2.init();
    chat2.socket = { id: 'socket_C' };

    chat2.appendMessage(ownMessage, true);
    const bubbleRejoined = document.getElementById('m_own_1');
    assert.ok(bubbleRejoined, 'Message must be rendered in rejoined chat instance');
    assert.ok(bubbleRejoined.classList.contains('outgoing'), 'Message must remain outgoing green bubble even though socket.id changed');
    assert.equal(bubbleRejoined.classList.contains('incoming'), false);
  });

  test('renderHistory does not increment unreadCount or play sound', () => {
    const chat = new ChatManager();
    chat.init();
    chat.isOpen = false;
    chat.unreadCount = 0;

    let soundPlayed = false;
    chat.playNotificationSound = () => { soundPlayed = true; };

    const historyMessages = [
      { id: 'hist_1', text: 'Existing message 1', senderName: 'Alice', timestamp: 1000 },
      { id: 'hist_2', text: 'Existing message 2', senderName: 'Bob', timestamp: 2000 }
    ];

    chat.renderHistory(historyMessages);

    assert.equal(chat.unreadCount, 0, 'History loading must not increment unread count');
    assert.equal(soundPlayed, false, 'History loading must not play notification sound');
  });

  test('clearMessages resets message container and renderedMessageIds on room switch', () => {
    const chat = new ChatManager();
    chat.init();

    chat.setRoom('room-1', 'viewer');
    chat.appendMessage({ id: 'r1_m1', text: 'Room 1 message', timestamp: 1000 });
    assert.equal(chat.renderedMessageIds.has('r1_m1'), true);
    assert.ok(document.getElementById('r1_m1'));

    // Switch to another room
    chat.setRoom('room-2', 'viewer');
    assert.equal(chat.roomId, 'room-2');
    assert.equal(chat.renderedMessageIds.has('r1_m1'), false);
    assert.equal(document.getElementById('r1_m1'), null);

    // Rejoining same room preserves rendered messages
    chat.appendMessage({ id: 'r2_m1', text: 'Room 2 message', timestamp: 2000 });
    assert.ok(document.getElementById('r2_m1'));

    chat.setRoom('room-2', 'viewer');
    assert.ok(document.getElementById('r2_m1'), 'Rejoining same room must not wipe current messages');
  });
});
