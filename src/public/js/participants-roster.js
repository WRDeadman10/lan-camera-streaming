/**
 * Renders the live room roster (sender and viewers) into a container.
 * Names are user-supplied, so every value is written with textContent, never innerHTML.
 */

/**
 * @param {HTMLElement} container
 * @param {{ senders: Array<{id: string, name: string}>, viewers: Array<{id: string, name: string}> }} payload
 * @param {string} selfId socket id of the local client
 * @param {'sender'|'viewer'} perspective which side is rendering the roster
 * @returns {number} viewer count
 */
export function renderRoster(container, payload, selfId, perspective) {
  if (!container) {
    return 0;
  }
  const senders = Array.isArray(payload.senders) ? payload.senders : [];
  const viewers = Array.isArray(payload.viewers) ? payload.viewers : [];

  container.textContent = '';

  if (perspective === 'viewer') {
    for (const sender of senders) {
      container.appendChild(buildRow(sender, 'sender', selfId));
    }
  }

  if (viewers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'roster-empty';
    empty.textContent = perspective === 'sender' ? 'No viewers connected yet.' : 'No other viewers yet.';
    container.appendChild(empty);
    return viewers.length;
  }

  for (const viewer of viewers) {
    container.appendChild(buildRow(viewer, 'viewer', selfId));
  }
  return viewers.length;
}

function buildRow(participant, role, selfId) {
  const row = document.createElement('div');
  row.className = `roster-row roster-row-${role}`;

  const avatar = document.createElement('span');
  avatar.className = 'roster-avatar';
  avatar.textContent = (participant.name || '?').charAt(0).toUpperCase();
  row.appendChild(avatar);

  const name = document.createElement('span');
  name.className = 'roster-name';
  name.textContent = participant.name || (role === 'sender' ? 'Streamer' : 'Viewer');
  row.appendChild(name);

  if (participant.id === selfId) {
    const you = document.createElement('span');
    you.className = 'roster-tag roster-tag-you';
    you.textContent = 'You';
    row.appendChild(you);
  }

  const badge = document.createElement('span');
  badge.className = `roster-tag roster-tag-${role}`;
  badge.textContent = role === 'sender' ? 'Sender' : 'Viewer';
  row.appendChild(badge);

  return row;
}
