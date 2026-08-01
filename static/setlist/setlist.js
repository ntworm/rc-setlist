const i18n = RcSetlistI18n;
const t = (key, params) => i18n.t(key, params);
const controllerRuntime = RcSetlistControllerRuntime;
const languageSelect = document.getElementById('languageSelect');
i18n.bindSelector(languageSelect);

let ws;
const port = window.location.port || '4444';
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const songListDiv = document.getElementById('songList');
const profileSelect = document.getElementById('profileSelect');
const profileManageModal = document.getElementById('profileManageModal');
const profileCreateName = document.getElementById('profileCreateName');
const btnCreateProfile = document.getElementById('btnCreateProfile');
const profileList = document.getElementById('profileList');
const deletedProfileList = document.getElementById('deletedProfileList');
const deletedProfileSection = document.getElementById('deletedProfileSection');
const profileMutationNotice = document.getElementById('profileMutationNotice');
const totalSetlistDuration = document.getElementById('totalSetlistDuration');
const operationToast = document.getElementById('operationToast');
let operationToastTimer = null;

const hudSong = document.getElementById('hudSong');
const hudSection = document.getElementById('hudSection');
const hudBpm = document.getElementById('hudBpm');
const hudDrift = document.getElementById('hudDrift');
const hudTime = document.getElementById('hudTime');
const hudBar = document.getElementById('hudBar');
const btnPrevious = document.getElementById('btnPrevious');
const btnPlay = document.getElementById('btnPlay');
const btnStop = document.getElementById('btnStop');
const btnNext = document.getElementById('btnNext');
const btnMetronome = document.getElementById('btnMetronome');
const btnRefresh = document.getElementById('btnRefresh');
const quantizationSelect = document.getElementById('quantizationSelect');
const hudLoopIter = document.getElementById('hudLoopIter');
const hudNextSong = document.getElementById('hudNextSong');
const hudNextSection = document.getElementById('hudNextSection');

let lastState = null;
let lastReceivedTime = 0;
let lastRenderedSongsJson = '';
let lastJumpTime = 0;
let lastJumpTarget = { song: -1, section: -1 };
let draggedSongIdx = null;
let isLocked = localStorage.getItem('bridge_locked') === 'true';
let lastFlashBeat = -1;
let currentLyrics = { song: '', format: 'none', lines: [] };
let currentLyricsIdx = -1;
let isController = false;
let isSynchronized = false;
let previousHoldController = null;
let nextHoldController = null;
let profileState = {
  version: 2,
  activeProfileId: '',
  profiles: [],
  deletedProfiles: [],
  canMutate: false,
  projectName: '',
};
const pendingProfileCommands = new Map();

function showConnectionFailure() {
  const hasState = Boolean(lastState);
  const overlay = document.getElementById('networkErrorOverlay');
  document.body.classList.toggle('connection-stale', hasState);
  document.body.classList.toggle('connection-empty', !hasState);
  overlay.querySelector('h2').textContent = t(hasState ? 'status.reconnecting' : 'status.bridgeUnavailable');
  overlay.querySelector('p').textContent = hasState
    ? t('status.panelLost')
    : t('status.noState');
  overlay.classList.add('visible');
}

function showToast(message, level = 'info') {
  if (!operationToast) return;
  if (operationToastTimer) clearTimeout(operationToastTimer);
  operationToast.textContent = message;
  operationToast.dataset.level = level;
  operationToast.hidden = false;
  operationToastTimer = setTimeout(() => {
    operationToast.hidden = true;
    operationToastTimer = null;
  }, 5000);
}

// MIDI Mapping State
let midiAccess = null;
const midiMappingDefaults = {
  'play': null,
  'stop': null,
  'next_song': null,
  'prev_song': null,
  'next_section': null,
  'prev_section': null,
  'toggle_click': null,
  'toggle_lock': null
};
let midiMappings = controllerRuntime.readMidiMappings(
  localStorage,
  'bridge_midi_mappings',
  midiMappingDefaults,
);
let activeMidiMappingKey = null; // Key currently being mapped
let currentMidiInputId = localStorage.getItem('bridge_midi_input_id') || '';

function updateLockVisuals() {
  const btn = document.getElementById('btnLock');
  const icon = document.getElementById('lockIcon');
  const text = document.getElementById('lockText');

  if (isLocked) {
    btn.classList.add('btn-locked-active');
    icon.textContent = '🔒';
    text.textContent = t('setlist.locked');
  } else {
    btn.classList.remove('btn-locked-active');
    icon.textContent = '🔓';
    text.textContent = t('setlist.unlocked');
  }
  updateTransportAvailability();
}

function toggleLock() {
  isLocked = !isLocked;
  localStorage.setItem('bridge_locked', isLocked);
  updateLockVisuals();
}

function showLockWarning() {
  let toast = document.getElementById('lockToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lockToast';
    toast.style.position = 'fixed';
    toast.style.bottom = '2rem';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'var(--danger)';
    toast.style.color = '#fff';
    toast.style.padding = '0.75rem 1.5rem';
    toast.style.borderRadius = '8px';
    toast.style.fontWeight = 'bold';
    toast.style.fontSize = '0.9rem';
    toast.style.boxShadow = '0 10px 25px rgba(239, 68, 68, 0.4)';
    toast.style.zIndex = '99999';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    toast.style.opacity = '0';
    document.body.appendChild(toast);
  }

  toast.textContent = t('setlist.lockWarning');
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(-5px)';

  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%)';
  }, 2000);
}

// Call updates on load
window.addEventListener('DOMContentLoaded', () => {
  updateLockVisuals();
  initMidi();
  document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
  });
  profileSelect.addEventListener('change', () => {
    if (!profileSelect.value || profileSelect.value === profileState.activeProfileId) return;
    sendProfileCommand('profile_select', { id: profileSelect.value });
  });
  profileCreateName.addEventListener('input', updateProfileMutationAvailability);
});

const modalOpeners = new WeakMap();

function closeManagedModal(modal) {
  if (!modal || !modal.classList.contains('open')) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  const opener = modalOpeners.get(modal);
  modalOpeners.delete(modal);
  opener?.focus?.();
}

function toggleProfileManageModal() {
  toggleManagedModal(profileManageModal, renderProfileState);
}

function closeProfileManageModal(event) {
  if (event.target === profileManageModal) {
    closeManagedModal(profileManageModal);
  }
}

function profileCommandId(type) {
  return `${type.replaceAll('_', '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function canMutateProfiles() {
  return Boolean(
    isController &&
    profileState.canMutate &&
    ws &&
    ws.readyState === WebSocket.OPEN
  );
}

function requestProfiles() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'profiles_get' }));
  }
}

function sendProfileCommand(type, payload = {}) {
  if (!canMutateProfiles()) {
    showToast(t('setlist.stopLiveFirst'), 'error');
    renderProfileState();
    return;
  }
  const commandId = profileCommandId(type);
  pendingProfileCommands.set(commandId, type);
  ws.send(JSON.stringify({ type, ...payload, commandId }));
}

function updateProfileMutationAvailability() {
  const mutable = canMutateProfiles();
  profileSelect.disabled = !mutable;
  profileCreateName.disabled = !mutable;
  btnCreateProfile.disabled = !mutable || !profileCreateName.value.normalize('NFKC').trim();
  profileMutationNotice.hidden = mutable;
  profileMutationNotice.textContent = mutable ? '' : t('setlist.stopLiveFirst');
  profileManageModal.querySelectorAll('.profile-mutation-control').forEach((control) => {
    if (!control.classList.contains('profile-delete-button')) {
      control.disabled = !mutable;
    }
  });
  profileManageModal.querySelectorAll('.profile-delete-group').forEach((group) => {
    const confirmation = group.querySelector('.profile-delete-confirmation');
    const deleteButton = group.querySelector('.profile-delete-button');
    deleteButton.disabled = !mutable ||
      confirmation.value.normalize('NFKC').trim() !== confirmation.dataset.expectedName;
  });
}

function appendProfileName(container, profile, deleted = false) {
  const name = document.createElement('strong');
  name.className = 'profile-name';
  name.textContent = profile.name;
  container.appendChild(name);
  if (profile.id === profileState.activeProfileId) {
    const badge = document.createElement('span');
    badge.className = 'profile-active-badge';
    badge.textContent = t('setlist.active');
    container.appendChild(badge);
  } else if (deleted && profile.deletedAt) {
    const deletedAt = document.createElement('small');
    deletedAt.textContent = new Date(profile.deletedAt).toLocaleString(i18n.getLocale());
    container.appendChild(deletedAt);
  }
}

function profileRegistryFingerprint(state) {
  return JSON.stringify({
    activeProfileId: state.activeProfileId,
    deletedProfiles: (state.deletedProfiles || []).map(({ id, name, deletedAt }) => ({ id, name, deletedAt })),
    profiles: (state.profiles || []).map(({ id, name }) => ({ id, name })),
    projectName: state.projectName || '',
    version: state.version,
  });
}

function captureProfileFieldFocus() {
  const field = document.activeElement;
  if (!field?.matches?.('.profile-rename-input, .profile-delete-confirmation')) return null;
  const row = field.closest('.profile-row');
  if (!row) return null;
  return {
    className: field.classList.contains('profile-rename-input')
      ? 'profile-rename-input'
      : 'profile-delete-confirmation',
    deletedProfileId: row.dataset.deletedProfileId || '',
    profileId: row.dataset.profileId || '',
    selectionEnd: field.selectionEnd,
    selectionStart: field.selectionStart,
    value: field.value,
  };
}

function restoreProfileFieldFocus(snapshot) {
  if (!snapshot) return;
  const rows = Array.from(profileManageModal.querySelectorAll('.profile-row'));
  const row = rows.find((candidate) => (
    (candidate.dataset.profileId || '') === snapshot.profileId &&
    (candidate.dataset.deletedProfileId || '') === snapshot.deletedProfileId
  ));
  const field = row?.querySelector(`.${snapshot.className}`);
  if (!field || field.disabled) return;
  field.value = snapshot.value;
  field.focus({ preventScroll: true });
  if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
    field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function renderProfileState() {
  const focusedField = captureProfileFieldFocus();
  profileSelect.textContent = '';
  for (const profile of profileState.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === profileState.activeProfileId;
    profileSelect.appendChild(option);
  }

  profileList.textContent = '';
  for (const profile of profileState.profiles) {
    const row = document.createElement('article');
    row.className = 'profile-row';
    row.dataset.profileId = profile.id;

    const heading = document.createElement('div');
    heading.className = 'profile-row-heading';
    appendProfileName(heading, profile);
    row.appendChild(heading);

    const renameGroup = document.createElement('div');
    renameGroup.className = 'profile-action-group';
    const renameInput = document.createElement('input');
    renameInput.className = 'profile-rename-input profile-mutation-control';
    renameInput.type = 'text';
    renameInput.maxLength = 80;
    renameInput.value = profile.name;
    renameInput.setAttribute('aria-label', t('setlist.renameSetlist', { name: profile.name }));
    const renameButton = document.createElement('button');
    renameButton.className = 'btn profile-rename-button profile-mutation-control';
    renameButton.type = 'button';
    renameButton.textContent = t('setlist.rename');
    const submitRename = () => {
      const name = renameInput.value.normalize('NFKC').trim();
      if (name && name !== profile.name) {
        sendProfileCommand('profile_rename', { id: profile.id, name });
      }
    };
    renameButton.addEventListener('click', submitRename);
    renameInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitRename();
    });
    renameGroup.append(renameInput, renameButton);
    row.appendChild(renameGroup);

    if (profile.id !== profileState.activeProfileId) {
      const deleteGroup = document.createElement('div');
      deleteGroup.className = 'profile-action-group profile-delete-group';
      const confirmation = document.createElement('input');
      confirmation.className = 'profile-delete-confirmation profile-mutation-control';
      confirmation.type = 'text';
      confirmation.autocomplete = 'off';
      confirmation.dataset.expectedName = profile.name;
      confirmation.placeholder = t('setlist.confirmationName', { name: profile.name });
      confirmation.setAttribute('aria-label', t('setlist.confirmationName', { name: profile.name }));
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-danger profile-delete-button profile-mutation-control';
      deleteButton.type = 'button';
      deleteButton.textContent = t('setlist.delete');
      const updateDeleteButton = () => {
        deleteButton.disabled = !canMutateProfiles() || confirmation.value.normalize('NFKC').trim() !== profile.name;
      };
      confirmation.addEventListener('input', updateDeleteButton);
      deleteButton.addEventListener('click', () => {
        sendProfileCommand('profile_delete', {
          id: profile.id,
          confirmationName: confirmation.value.normalize('NFKC').trim(),
        });
      });
      deleteGroup.append(confirmation, deleteButton);
      row.appendChild(deleteGroup);
      updateDeleteButton();
    }
    profileList.appendChild(row);
  }

  deletedProfileList.textContent = '';
  const deletedProfiles = Array.isArray(profileState.deletedProfiles) ? profileState.deletedProfiles : [];
  deletedProfileSection.hidden = deletedProfiles.length === 0;
  for (const profile of deletedProfiles) {
    const row = document.createElement('article');
    row.className = 'profile-row deleted-profile-row';
    row.dataset.deletedProfileId = profile.id;
    const heading = document.createElement('div');
    heading.className = 'profile-row-heading';
    appendProfileName(heading, profile, true);
    const restoreButton = document.createElement('button');
    restoreButton.className = 'btn profile-restore-button profile-mutation-control';
    restoreButton.type = 'button';
    restoreButton.textContent = t('setlist.restore');
    restoreButton.addEventListener('click', () => {
      sendProfileCommand('profile_restore', { id: profile.id });
    });
    row.append(heading, restoreButton);
    deletedProfileList.appendChild(row);
  }
  updateProfileMutationAvailability();
  restoreProfileFieldFocus(focusedField);
}

function createProfile() {
  const name = profileCreateName.value.normalize('NFKC').trim();
  if (!name) return;
  sendProfileCommand('profile_create', { name });
}

function toggleManagedModal(modal, onOpen) {
  if (modal.classList.contains('open')) {
    closeManagedModal(modal);
    return;
  }
  const opener = document.activeElement;
  if (opener && opener !== document.body) modalOpeners.set(modal, opener);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  onOpen?.();
  const focusTarget = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  focusTarget?.focus?.();
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const openModal = document.querySelector('.modal-overlay.open');
  if (!openModal) return;
  event.preventDefault();
  closeManagedModal(openModal);
});

const midiInputSelect = document.getElementById('midiInputSelect');
const midiModal = document.getElementById('midiModal');

function toggleMidiModal() {
  toggleManagedModal(midiModal, () => {
    renderMidiMappings();
  });
}

function closeMidiModal(e) {
  if (e.target === midiModal) {
    closeManagedModal(midiModal);
  }
}

function initMidi() {
  if (!navigator.requestMIDIAccess) {
    midiInputSelect.innerHTML = `<option value="">${escapeLyricsEditorText(t('midi.unsupported'))}</option>`;
    return;
  }

  navigator.requestMIDIAccess()
    .then(access => {
      midiAccess = access;
      updateMidiDevices();
      midiAccess.onstatechange = updateMidiDevices;
    })
    .catch(err => {
      console.warn('[MIDI] MIDI access denied:', err);
      midiInputSelect.innerHTML = `<option value="">${escapeLyricsEditorText(t('midi.permissionDenied'))}</option>`;
    });
}

function updateMidiDevices() {
  if (!midiAccess) return;

  const inputs = Array.from(midiAccess.inputs.values());
  midiInputSelect.innerHTML = '';

  if (inputs.length === 0) {
    midiInputSelect.innerHTML = `<option value="">${escapeLyricsEditorText(t('midi.noDevices'))}</option>`;
    return;
  }

  inputs.forEach(input => {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name;
    if (input.id === currentMidiInputId) {
      option.selected = true;
    }
    midiInputSelect.appendChild(option);
  });

  midiInputSelect.onchange = (e) => {
    currentMidiInputId = e.target.value;
    localStorage.setItem('bridge_midi_input_id', currentMidiInputId);
    bindMidiListeners();
  };

  bindMidiListeners();
}

function bindMidiListeners() {
  if (!midiAccess) return;

  // Unbind all inputs first
  midiAccess.inputs.forEach(input => {
    input.onmidimessage = null;
  });

  const selectedInput = midiAccess.inputs.get(currentMidiInputId) || Array.from(midiAccess.inputs.values())[0];
  if (selectedInput) {
    currentMidiInputId = selectedInput.id;
    localStorage.setItem('bridge_midi_input_id', currentMidiInputId);
    selectedInput.onmidimessage = onMidiMessage;
  }
}

function onMidiMessage(event) {
  const data = event.data;
  if (!data || data.length < 2) return;

  const status = data[0];
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const number = data[1];
  const value = data.length > 2 ? data[2] : 0;

  // Detect Note On (with velocity > 0) or Control Change (with value > 0)
  const isNoteOn = (type === 0x90 && value > 0);
  const isCC = (type === 0xb0 && value > 0);

  if (!isNoteOn && !isCC) return;

  const midiType = isNoteOn ? 'note' : 'cc';

  if (activeMidiMappingKey) {
    // Map this message
    midiMappings[activeMidiMappingKey] = {
      type: midiType,
      channel: channel,
      number: number
    };
    localStorage.setItem('bridge_midi_mappings', JSON.stringify(midiMappings));
    activeMidiMappingKey = null;
    renderMidiMappings();
    return;
  }

  // Check if matches any active mapping
  for (const [actionKey, mapping] of Object.entries(midiMappings)) {
    if (mapping && mapping.type === midiType && mapping.channel === channel && mapping.number === number) {
      executeMidiAction(actionKey);
      break;
    }
  }
}

const actionLabelKeys = {
  'play': 'midi.play',
  'stop': 'midi.stop',
  'next_song': 'midi.nextSong',
  'prev_song': 'midi.previousSong',
  'next_section': 'midi.nextSection',
  'prev_section': 'midi.previousSection',
  'toggle_click': 'midi.toggleClick',
  'toggle_lock': 'midi.toggleLock'
};

function renderMidiMappings() {
  const tbody = document.getElementById('midiMappingTableBody');
  tbody.innerHTML = '';

  Object.entries(midiMappings).forEach(([key, mapping]) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px dashed rgba(255,255,255,0.05)';

    const tdAction = document.createElement('td');
    tdAction.style.padding = '0.5rem 0';
    tdAction.textContent = actionLabelKeys[key] ? t(actionLabelKeys[key]) : key;

    const tdMap = document.createElement('td');
    tdMap.style.padding = '0.5rem 0';
    if (activeMidiMappingKey === key) {
      tdMap.innerHTML = `<span style="color: var(--accent); font-weight: bold; animation: pulse 1s infinite;">${escapeLyricsEditorText(t('midi.waiting'))}</span>`;
    } else if (mapping) {
      const typeStr = mapping.type === 'cc' ? 'CC' : 'Nota';
      tdMap.textContent = `${typeStr} ${mapping.number} (Ch ${mapping.channel})`;
    } else {
      tdMap.textContent = t('midi.notMapped');
      tdMap.style.color = 'var(--text-muted)';
    }

    const tdCtrl = document.createElement('td');
    tdCtrl.style.padding = '0.5rem 0';
    tdCtrl.style.textAlign = 'right';

    const btnMap = document.createElement('button');
    btnMap.textContent = t(activeMidiMappingKey === key ? 'common.cancel' : 'common.map');
    btnMap.style.background = 'rgba(255,255,255,0.05)';
    btnMap.style.border = '1px solid var(--card-border)';
    btnMap.style.color = '#fff';
    btnMap.style.padding = '0.2rem 0.5rem';
    btnMap.style.borderRadius = '4px';
    btnMap.style.cursor = 'pointer';
    btnMap.onclick = () => {
      if (activeMidiMappingKey === key) {
        activeMidiMappingKey = null;
      } else {
        activeMidiMappingKey = key;
      }
      renderMidiMappings();
    };

    tdCtrl.appendChild(btnMap);

    if (mapping && activeMidiMappingKey !== key) {
      const btnClear = document.createElement('button');
      btnClear.textContent = t('common.clear');
      btnClear.style.background = 'rgba(239, 68, 68, 0.1)';
      btnClear.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      btnClear.style.color = 'var(--danger)';
      btnClear.style.padding = '0.2rem 0.5rem';
      btnClear.style.borderRadius = '4px';
      btnClear.style.marginLeft = '0.5rem';
      btnClear.style.cursor = 'pointer';
      btnClear.onclick = () => {
        midiMappings[key] = null;
        localStorage.setItem('bridge_midi_mappings', JSON.stringify(midiMappings));
        renderMidiMappings();
      };
      tdCtrl.appendChild(btnClear);
    }

    tr.appendChild(tdAction);
    tr.appendChild(tdMap);
    tr.appendChild(tdCtrl);
    tbody.appendChild(tr);
  });
}

function executeMidiAction(action) {
  if (action === 'play') {
    sendControl('play');
  } else if (action === 'stop') {
    sendControl('stop');
  } else if (action === 'next_song') {
    const nextIdx = lastState ? lastState.activeSongIndex + 1 : -1;
    if (lastState && nextIdx >= 0 && nextIdx < lastState.songs.length) jumpTo(nextIdx, null);
  } else if (action === 'prev_song') {
    const prevIdx = lastState ? lastState.activeSongIndex - 1 : -1;
    if (prevIdx >= 0) jumpTo(prevIdx, null);
  } else if (action === 'next_section') {
    navigateAdjacent('next');
  } else if (action === 'prev_section') {
    navigateAdjacent('previous');
  } else if (action === 'toggle_click') {
    toggleMetronome();
  } else if (action === 'toggle_lock') {
    toggleLock();
  }
}

function canUseTransport() {
  return Boolean(isController && ws && ws.readyState === WebSocket.OPEN && lastState && !isLocked);
}

function navigateAdjacent(direction) {
  const target = SetlistTransportRuntime.resolveNavigationTarget(lastState, direction);
  if (target) jumpTo(target.songIndex, target.sectionIndex);
}

function updateTransportAvailability() {
  const available = canUseTransport();
  languageSelect.disabled = isLocked || Boolean(lastState?.isPlaying);
  languageSelect.setAttribute('aria-disabled', String(languageSelect.disabled));
  btnPlay.disabled = !available;
  btnStop.disabled = !available;
  btnMetronome.disabled = !available;
  btnRefresh.disabled = !available;
  quantizationSelect.disabled = !available;
  previousHoldController?.update();
  nextHoldController?.update();
}

function mountTransportControls() {
  const shared = {
    getState: () => lastState,
    canNavigate: canUseTransport,
    onNavigate: (target) => jumpTo(target.songIndex, target.sectionIndex),
  };
  previousHoldController = SetlistTransportRuntime.mountHoldButton({
    ...shared,
    button: btnPrevious,
    direction: 'previous',
  });
  nextHoldController = SetlistTransportRuntime.mountHoldButton({
    ...shared,
    button: btnNext,
    direction: 'next',
  });
  btnPlay.addEventListener('click', () => sendControl('play'));
  btnStop.addEventListener('click', () => sendControl('stop'));
  updateTransportAvailability();
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = controllerRuntime.consumeControllerToken({
    historyRef: window.history,
    locationRef: window.location,
    storageRef: localStorage,
  });
  const url = `${protocol}//${window.location.hostname}:${port}/ws?token=${encodeURIComponent(token)}`;
  const loggedUrl = url.replace(/token=[^&]+/g, 'token=***');
  console.log('[WS] connecting to', loggedUrl);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] connected');
    statusDot.className = 'status-dot connected';
    statusText.textContent = t('status.connected');
    document.body.classList.remove('connection-stale');
    document.body.classList.remove('connection-empty');
    document.getElementById('networkErrorOverlay').classList.remove('visible');

    // Send handshake
    ws.send(JSON.stringify({
      type: 'handshake',
      clientId: 'browser-setlist-' + Math.random().toString(36).substring(7)
    }));
  };

  ws.onerror = (event) => {
    // WebSocket errors don't carry useful detail in most browsers, but the
    // event itself being fired tells us the handshake or transport failed.
    // Surface that in the status text + console so the user can diagnose
    // without opening DevTools.
    console.error('[WS] error:', event);
    statusDot.className = 'status-dot error';
    statusText.textContent = t('status.wsError');
    appendLog(t('feedback.wsHandshake'), 'error');
  };

  ws.onclose = (event) => {
    console.log('[WS] closed:', event.code, event.reason || '(no reason)');
    barDisplayStabilizer.reset();
    statusDot.className = 'status-dot';
    statusText.textContent = t(lastState ? 'status.reconnecting' : 'status.disconnected');
    isController = false;
    isSynchronized = false;
    previousHoldController?.reset();
    nextHoldController?.reset();
    jumpConfirmation.clear();
    quantizationConfirmation.reset();
    lyricsSaveTracker.failAll('disconnected');
    updateTransportAvailability();
    renderProfileState();
    showConnectionFailure();
    if (event.code !== 1000 && event.code !== 1001) {
      appendLog(t('feedback.wsClosed', { code: event.code, reason: event.reason || '(none)' }), 'warn');
    }
    setTimeout(connect, 3000); // Reconnect
  };

  let lastActiveSongIdx = -2;  // sentinel != any real index → forces fetch on first state
  let lyricsFetchInFlight = false;

  ws.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.type === 'handshake_ack') {
        // Send sync_confirm
        ws.send(JSON.stringify({ type: 'sync_confirm', stateVersion: payload.stateVersion }));
        isSynchronized = true;
        requestProfiles();
        if (payload.state) {
          barDisplayStabilizer.observeState(lastState, payload.state);
          lastState = payload.state;
          quantizationConfirmation.observe(lastState.clipTriggerQuantization);
          jumpConfirmation.observeState(lastState);
          renderSongList(lastState);
          renderJumpFeedback(jumpConfirmation.snapshot());
          updateTransportAvailability();
        }
        return;
      }
      if (payload.type === 'state') {
        const prevActiveIdx = lastState ? lastState.activeSongIndex : -1;
        barDisplayStabilizer.observeState(lastState, payload.state);
        lastState = payload.state;
        if (profileState.profiles.length > 0) {
          profileState = { ...profileState, canMutate: !lastState.isPlaying };
          updateProfileMutationAvailability();
        }
        quantizationConfirmation.observe(lastState.clipTriggerQuantization);
        lastReceivedTime = performance.now();
        document.body.classList.remove('connection-stale');
        document.body.classList.remove('connection-empty');
        document.getElementById('networkErrorOverlay').classList.remove('visible');
        jumpConfirmation.observeState(lastState);
        renderSongList(lastState);
        renderJumpFeedback(jumpConfirmation.snapshot());
        updateTransportAvailability();
        // Ask backend for lyrics whenever the active song changes (or on
        // first state after connect). Backend saves .lrc to disk and
        // re-broadcasts when active changes; this guarantees the HUD gets
        // lyrics even if the user connects mid-set or after a reload.
        const newActiveIdx = lastState.activeSongIndex;
        if (newActiveIdx !== -1 && newActiveIdx !== lastActiveSongIdx && ws.readyState === 1) {
          lastActiveSongIdx = newActiveIdx;
          if (!lyricsFetchInFlight) {
            lyricsFetchInFlight = true;
            ws.send(JSON.stringify({ type: 'get_lyrics' }));
            setTimeout(() => { lyricsFetchInFlight = false; }, 250);
          }
        }
      } else if (payload.type === 'log') {
        appendLog(payload.message, payload.level, payload.timestamp);
      } else if (payload.type === 'lyrics') {
        // Backend broadcasts {type:'lyrics', song, format, lines} whenever
        // the active song changes or a modal editor requests another song.
        // Only the active song owns the HUD; editor-only replies must never
        // replace the synchronized lyrics being performed.
        if (payload.song === activeSongTitle()) {
          currentLyrics = {
            song: payload.song || '',
            format: payload.format || 'none',
            lines: Array.isArray(payload.lines) ? payload.lines : []
          };
          currentLyricsIdx = -1; // force re-evaluation against the new lines
          renderActiveLyric();
        }
        // The modal separately accepts a reply matching its selected song.
        applyLyricsLoadToEditor(payload);
      } else if (payload.type === 'csv_ready') {
        handleCsvReady(payload.url, payload.count, payload.fileName);
      } else if (payload.type === 'jump_pending') {
        jumpConfirmation.pending(payload);
      } else if (payload.type === 'jump_executed') {
        jumpConfirmation.executed(payload);
      } else if (payload.type === 'auth_status') {
        isController = Boolean(payload.isController);
        if (!isController) lyricsSaveTracker.failAll('unauthorized');
        if (!payload.isController) {
          appendLog(t('feedback.readOnly'), 'warn');
          const statusTextEl = document.getElementById('statusText');
          if (statusTextEl) statusTextEl.textContent = t('status.readOnly');
        } else {
          appendLog(t('feedback.controller'), 'info');
        }
        updateTransportAvailability();
        if (isSynchronized) requestProfiles();
        renderProfileState();
      } else if (payload.type === 'profiles_state') {
        const nextProfileState = {
          version: payload.version,
          activeProfileId: typeof payload.activeProfileId === 'string' ? payload.activeProfileId : '',
          profiles: Array.isArray(payload.profiles) ? payload.profiles : [],
          deletedProfiles: Array.isArray(payload.deletedProfiles) ? payload.deletedProfiles : [],
          canMutate: Boolean(payload.canMutate),
          projectName: typeof payload.projectName === 'string' ? payload.projectName : '',
        };
        const registryChanged =
          profileRegistryFingerprint(nextProfileState) !== profileRegistryFingerprint(profileState);
        profileState = nextProfileState;
        if (registryChanged) renderProfileState();
        else updateProfileMutationAvailability();
      } else if (payload.type === 'command_status') {
        lyricsSaveTracker.settle(payload);
        quantizationConfirmation.settle(payload);
        const profileCommand = pendingProfileCommands.get(payload.commandId);
        if (profileCommand && ['confirmed', 'failed', 'expired', 'cancelled'].includes(payload.status)) {
          pendingProfileCommands.delete(payload.commandId);
          if (payload.status === 'failed') {
            showToast(t('setlist.operationFailed'), 'error');
          }
          requestProfiles();
        }
      } else if (payload.type === 'error') {
        lyricsSaveTracker.failAll('server_error');
        const message = t('feedback.serverError', { detail: payload.message });
        appendLog(`⚠ ${message}`, 'error');
        alert(message);
      }
    } catch (err) {
      console.error('Could not process server message:', err);
    }
  };
}

function formatBeatsAsTime(beats, bpmSource) {
  if (typeof beats !== 'number' || isNaN(beats)) return '0:00:00';
  let bpm = 120;
  if (typeof bpmSource === 'number') {
    bpm = bpmSource;
  } else if (bpmSource && typeof bpmSource.bpm === 'number') {
    bpm = bpmSource.bpm;
  } else if (lastState && lastState.tempo) {
    bpm = lastState.tempo;
  }
  const seconds = beats * 60 / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
}

function formatDuration(seconds, includeHours = false) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (includeHours || hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}



function renderActiveLyric() {
  const el = document.getElementById('hudLyric');
  if (!el) return;
  if (!currentLyrics.lines || currentLyrics.lines.length === 0) {
    el.textContent = currentLyrics.song ? t('setlist.noSavedLyrics') : '—';
    return;
  }
  const idx = currentLyricsIdx;
  if (idx < 0 || idx >= currentLyrics.lines.length) {
    el.textContent = '—';
    return;
  }
  el.textContent = currentLyrics.lines[idx].text || '—';
}

/**
 * Drift badge — compares live tempo (state.tempo) with the BPM expected
 * by the active song (song.bpm). Shows a colored Δ badge when they don't
 * match: cyan for tiny deviation (informational), amber for noticeable,
 * red for severe. Hides when within rounding tolerance or no expectation
 * is defined (cue without an explicit [bpm X] tag).
 */
function updateDriftBadge(state, activeSong) {
  if (!hudDrift) return;
  const live = typeof state?.tempo === 'number' ? state.tempo : null;
  const expected = activeSong && typeof activeSong.bpm === 'number' ? activeSong.bpm : null;
  if (live == null || expected == null) {
    hudDrift.style.display = 'none';
    return;
  }
  const delta = live - expected;
  const abs = Math.abs(delta);
  // Within rounding tolerance — hide.
  if (abs < 0.05) {
    hudDrift.style.display = 'none';
    return;
  }
  const sign = delta > 0 ? '+' : '−';
  hudDrift.textContent = `⚠ Δ${sign}${Math.abs(delta).toFixed(1)}`;
  hudDrift.title = t('setlist.driftTitle', {
    expected: expected.toFixed(1),
    live: live.toFixed(1),
  });
  // Severity tiers:
  //   < 0.5: cyan (informational rounding)
  //   0.5 - 2.0: amber (noticeable, likely intentional)
  //   > 2.0: red (severe, click will go out of sync)
  let bg, fg, border;
  if (abs < 0.5) {
    bg = 'rgba(34, 211, 238, 0.15)';
    fg = '#67e8f9';
    border = 'rgba(34, 211, 238, 0.4)';
  } else if (abs < 2.0) {
    bg = 'rgba(251, 191, 36, 0.15)';
    fg = '#fbbf24';
    border = 'rgba(251, 191, 36, 0.4)';
  } else {
    bg = 'rgba(239, 68, 68, 0.2)';
    fg = '#fca5a5';
    border = 'rgba(239, 68, 68, 0.5)';
  }
  hudDrift.style.display = 'inline-block';
  hudDrift.style.background = bg;
  hudDrift.style.color = fg;
  hudDrift.style.border = `1px solid ${border}`;
}

const latencyCompensationMs = 90; // compensate for polling intervals + socket transit
const barDisplayStabilizer = SetlistTransportRuntime.createBarDisplayStabilizer();

function sectionDisplayName(section) {
  if (!section) return t('common.none');
  return section.automationOnly || !section.name
    ? t('setlist.automationMarker')
    : section.name;
}

function getEstimatedBeats() {
  if (!lastState) return 0;
  if (!lastState.isPlaying) return lastState.currentSongTime;
  const elapsedMs = (performance.now() - lastReceivedTime) + latencyCompensationMs;
  const elapsedBeats = (elapsedMs / 1000) * (lastState.tempo / 60);
  return lastState.currentSongTime + elapsedBeats;
}

function tick() {
  if (lastState) {
    // 1. Update HUD values
    const activeSong = lastState.songs[lastState.activeSongIndex];
    const activeSection = activeSong ? activeSong.sections[lastState.activeSectionIndex] : null;

    hudSong.textContent = activeSong ? activeSong.title : t('common.none');
    hudSection.textContent = sectionDisplayName(activeSection);
    hudBpm.textContent = lastState.tempo ? lastState.tempo.toFixed(1) : '120.0';

    // Drift: compare live tempo with the cue-derived BPM expectation.
    updateDriftBadge(lastState, activeSong);

    // Update Next Song / Section
    const nextSongObj = lastState.songs[lastState.activeSongIndex + 1];
    hudNextSong.textContent = nextSongObj
      ? t('setlist.nextValue', { name: nextSongObj.title })
      : t('setlist.nextEndSet');

    let nextSectionObj = null;
    let nextIsCurrent = false;

    if (activeSong) {
      if (lastState.loopActive) {
        if (lastState.loopCount === -1 || lastState.currentLoopIteration < lastState.loopCount) {
          nextIsCurrent = true;
        }
      }

      if (nextIsCurrent) {
        nextSectionObj = activeSection;
      } else {
        nextSectionObj = activeSong.sections[lastState.activeSectionIndex + 1];
        if (!nextSectionObj && nextSongObj) {
          nextSectionObj = nextSongObj.sections[0];
        }
      }
    }

    if (nextIsCurrent && nextSectionObj) {
      hudNextSection.textContent = t('setlist.nextRepeat', { name: sectionDisplayName(nextSectionObj) });
    } else {
      hudNextSection.textContent = nextSectionObj
        ? t('setlist.nextValue', { name: sectionDisplayName(nextSectionObj) })
        : t('setlist.nextEnd');
    }

    const estimatedBeats = getEstimatedBeats();
    const songElapsedBeats = calculateSongElapsedBeats(estimatedBeats, activeSong);
    hudTime.textContent = formatBeatsAsTime(estimatedBeats, lastState.tempo);

    const hudSongTimeEl = document.getElementById('hudSongTime');
    if (hudSongTimeEl) {
      if (activeSong) {
        hudSongTimeEl.textContent = t('setlist.songTime', {
          time: formatBeatsAsTime(songElapsedBeats, lastState.tempo),
        });
        hudSongTimeEl.style.display = 'inline-block';
      } else {
        hudSongTimeEl.style.display = 'none';
      }
    }

    // Lyrics: pick the active line for the current playback time and update
    // the HUD card. Only updates the DOM when the index actually changes, so
    // we're not reflowing on every rAF tick.
    {
      const bpm = lastState.tempo || 120;
      const currentSec = convertBeatsToSeconds(songElapsedBeats, bpm);
      const newIdx = findActiveLyricLine(currentLyrics, currentSec);
      if (newIdx !== currentLyricsIdx) {
        currentLyricsIdx = newIdx;
        renderActiveLyric();
      }
    }

    // Bar calculation (Bars.Beats.Sixteenths). Keep the last valid visual
    // value while disconnected instead of reseeding from stale extrapolation.
    const num = lastState.signatureNumerator || 4;
    if (isSynchronized) {
      const barDisplayBeats = barDisplayStabilizer.update(estimatedBeats, lastState.isPlaying);
      const bar = Math.floor(barDisplayBeats / num) + 1;
      const remainingBeats = barDisplayBeats % num;
      const beat = Math.floor(remainingBeats) + 1;
      const sixteenths = Math.floor((remainingBeats % 1) * 4) + 1;
      hudBar.textContent = `${bar}.${beat}.${sixteenths}`;
    }

    // Update Lyrics Sync Timer display
    if (typeof isLyricsSyncing !== 'undefined' && isLyricsSyncing) {
      const syncTimecodeEl = document.getElementById('lyricsSyncTimecode');
      if (syncTimecodeEl) {
        syncTimecodeEl.textContent = hudTime.textContent;
      }
    }

    // Metronome Visual Beat Flash
    const currentIntBeat = Math.floor(estimatedBeats);
    if (Math.abs(currentIntBeat - lastFlashBeat) > 4) {
      lastFlashBeat = currentIntBeat;
    } else if (currentIntBeat > lastFlashBeat && lastState.isPlaying) {
      lastFlashBeat = currentIntBeat;
      const bpmCard = document.getElementById('bpmCard');
      if (bpmCard) {
        const isDownbeat = currentIntBeat % num === 0;
        bpmCard.classList.remove('beat-flash-accent', 'beat-flash-normal');
        void bpmCard.offsetWidth; // force reflow
        if (isDownbeat) {
          bpmCard.classList.add('beat-flash-accent');
        } else {
          bpmCard.classList.add('beat-flash-normal');
        }
      }
    }

    // Update Metronome Button active state class
    if (lastState.metronome) {
      btnMetronome.classList.add('btn-click-active');
    } else {
      btnMetronome.classList.remove('btn-click-active');
    }

    // Update Loop Iteration display
    if (lastState.loopIteration) {
      hudLoopIter.textContent = `LOOP: ${lastState.loopIteration.current}/${lastState.loopIteration.total}`;
      hudLoopIter.style.display = 'inline-block';
    } else {
      hudLoopIter.style.display = 'none';
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function handleDragStart(e, idx) {
  if (isLocked) {
    e.preventDefault();
    showLockWarning();
    return;
  }
  draggedSongIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
}

function handleDragEnd(e) {
  e.currentTarget.style.opacity = '1';
  draggedSongIdx = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e, targetIdx) {
  e.preventDefault();
  if (isLocked) {
    showLockWarning();
    return;
  }
  if (draggedSongIdx === null || draggedSongIdx === targetIdx) return;
  if (lastState && lastState.songs) {
    const order = [...lastState.songs];
    const [moved] = order.splice(draggedSongIdx, 1);
    order.splice(targetIdx, 0, moved);
    const titles = order.map(s => s.title);
    sendReorder(titles);
  }
}

function sendReorder(songTitles) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'reorder',
      songTitles
    }));
  }
}

function renderSongList(state) {
  totalSetlistDuration.textContent = formatDuration(state.totalDurationSeconds);
  totalSetlistDuration.title = typeof state.totalDurationSeconds === 'number'
    ? t('setlist.totalDuration')
    : t('setlist.unknownDuration');
  if (!state.songs || state.songs.length === 0) {
    songListDiv.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">${escapeLyricsEditorText(t('setlist.noSongs'))}</div>`;
    lastRenderedSongsJson = '';
    return;
  }

  const currentJson = JSON.stringify({
    songs: state.songs,
    hidden: state.hidden
  });

  if (currentJson === lastRenderedSongsJson) {
    updateActiveClasses(state.activeSongIndex, state.activeSectionIndex);
    return;
  }

  lastRenderedSongsJson = currentJson;

  let html = '';
  state.songs.forEach((song, songIdx) => {
    const isActiveSong = songIdx === state.activeSongIndex;
    html += `
      <div class="song-item ${isActiveSong ? 'active' : ''}" draggable="true" ondragstart="handleDragStart(event, ${songIdx})" ondragover="handleDragOver(event)" ondrop="handleDrop(event, ${songIdx})" ondragend="handleDragEnd(event)">
        <div class="song-header" data-song="${songIdx}" onclick="jumpTo(${songIdx}, null)">
          <div class="song-info">
            <span class="song-index">${songIdx + 1}</span>
            <span class="song-title">${escapeLyricsEditorText(song.title)}</span>
            ${song.loopCount !== null ? `<span class="loop-badge">${song.loopCount === -1 ? '↻ LOOP' : `↻ LOOP ${song.loopCount}x`}</span>` : ''}
            ${song.autoStop ? `<span class="stop-badge">■ STOP</span>` : ''}
            ${song.autoNext ? `<span class="next-badge">⏭ NEXT</span>` : ''}
            ${typeof song.bpm === 'number' ? `<span class="bpm-badge">♩ ${song.bpm} BPM</span>` : ''}
          </div>
          <span class="song-time">${formatDuration(song.durationSeconds)}</span>
        </div>

        ${song.sections && song.sections.length > 0 ? `
          <div class="song-sections">
            ${song.sections.map((sec, secIdx) => {
              const isActiveSection = isActiveSong && secIdx === state.activeSectionIndex;
              return `
                <button class="section-btn ${isActiveSection ? 'active' : ''}" data-song="${songIdx}" data-section="${secIdx}" onclick="jumpTo(${songIdx}, ${secIdx})">
                  <span class="section-name">${escapeLyricsEditorText(sectionDisplayName(sec))}</span>
                  ${sec.loopCount !== null ? `<span class="loop-badge">${sec.loopCount === -1 ? '↻ LOOP' : `↻ LOOP ${sec.loopCount}x`}</span>` : ''}
                  ${sec.autoStop ? `<span class="stop-badge">■ STOP</span>` : ''}
                  ${sec.autoNext ? `<span class="next-badge">⏭ NEXT</span>` : ''}
                  ${typeof sec.bpm === 'number' ? `<span class="bpm-badge">♩ ${sec.bpm} BPM</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  });
  songListDiv.innerHTML = html;
}

function updateActiveClasses(activeSongIdx, activeSectionIdx) {
  const songItems = songListDiv.querySelectorAll('.song-item');
  songItems.forEach((item, songIdx) => {
    const shouldBeActiveSong = (songIdx === activeSongIdx);
    if (shouldBeActiveSong) {
      if (!item.classList.contains('active')) {
        item.classList.add('active');
      }
    } else {
      if (item.classList.contains('active')) {
        item.classList.remove('active');
      }
    }

    const sectionBtns = item.querySelectorAll('.section-btn');
    sectionBtns.forEach((btn) => {
      const sectionIdx = parseInt(btn.getAttribute('data-section'), 10);
      const shouldBeActiveSec = shouldBeActiveSong && (sectionIdx === activeSectionIdx);
      if (shouldBeActiveSec) {
        if (!btn.classList.contains('active')) {
          btn.classList.add('active');
        }
      } else {
        if (btn.classList.contains('active')) {
          btn.classList.remove('active');
        }
      }
    });
  });
}

function jumpTargetElement(target) {
  if (!target) return null;
  if (target.sectionIndex === null) {
    return document.querySelector(`.song-header[data-song="${target.songIndex}"]`);
  }
  return document.querySelector(`.section-btn[data-song="${target.songIndex}"][data-section="${target.sectionIndex}"]`);
}

function renderJumpFeedback(snapshot) {
  document.querySelectorAll('.jumping, .jump-confirming').forEach((element) => {
    element.classList.remove('jumping', 'jump-confirming');
  });
  const target = jumpTargetElement(snapshot.target);
  if (!target) return;
  target.classList.add(snapshot.phase === 'confirming' ? 'jump-confirming' : 'jumping');
}

const jumpConfirmation = SetlistTransportRuntime.createJumpConfirmation({
  onChange: renderJumpFeedback,
  onTimeout: () => appendLog(t('feedback.jumpTimeout'), 'warn'),
});

function renderQuantization(snapshot) {
  if (snapshot.displayValue !== null) {
    quantizationSelect.value = String(snapshot.displayValue);
  }
  const busy = Boolean(snapshot.pending);
  quantizationSelect.classList.toggle('is-pending', busy);
  quantizationSelect.setAttribute('aria-busy', String(busy));
}

const quantizationConfirmation = SetlistTransportRuntime.createQuantizationConfirmation({
  onChange: renderQuantization,
  onFailure: () => appendLog(t('feedback.quantizationFailed'), 'warn'),
});

function jumpTo(songIndex, sectionIndex) {
  if (isLocked) {
    showLockWarning();
    return;
  }
  if (!canUseTransport()) return;

  const now = Date.now();
  if (now - lastJumpTime < 300 && lastJumpTarget.song === songIndex && lastJumpTarget.section === sectionIndex) {
    console.log('[Jump] Throttled rapid duplicate click');
    return;
  }
  lastJumpTime = now;
  lastJumpTarget = { song: songIndex, section: sectionIndex };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'jump',
      songIndex,
      sectionIndex
    }));
  }
}

function sendControl(controlType) {
  if (isLocked) {
    showLockWarning();
    return;
  }
  if (!canUseTransport()) return;
  ws.send(JSON.stringify({ type: controlType }));
}

function exportCsv() {
  if (isLocked) {
    showLockWarning();
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast(t('lyrics.notConnected'), 'error');
    return;
  }
  const btn = document.getElementById('btnExportCsv');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
  }
  ws.send(JSON.stringify({ type: 'export_csv' }));
}

// One-shot listener for csv_ready: opens the export URL (Content-Disposition
// header on the server side triggers a browser download).
function handleCsvReady(url, count, fileName) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  if (fileName) a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(t('feedback.csv', { count, fileName }), 'success');
  const btn = document.getElementById('btnExportCsv');
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

function toggleMetronome() {
  if (isLocked) {
    showLockWarning();
    return;
  }
  if (!canUseTransport()) return;
  ws.send(JSON.stringify({
    type: 'metronome',
    value: !lastState.metronome
  }));
}

const logPanel = document.getElementById('logPanel');

function changeQuantization(val) {
  if (isLocked || !canUseTransport()) {
    if (isLocked) showLockWarning();
    renderQuantization(quantizationConfirmation.snapshot());
    return;
  }
  const value = Number.parseInt(val, 10);
  const commandId = `quantization-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  if (!quantizationConfirmation.begin({ value, commandId })) return;
  ws.send(JSON.stringify({
    type: 'set_quantization',
    value,
    commandId,
  }));
}
function appendLog(message, level = 'info', timestamp = Date.now()) {
  const timeStr = new Date(timestamp).toLocaleTimeString(i18n.getLocale(), { hour12: false });
  const line = document.createElement('div');
  line.className = 'log-line';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${timeStr}]`;

  const msgSpan = document.createElement('span');
  msgSpan.className = `log-msg-${level}`;
  msgSpan.textContent = message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);

  logPanel.appendChild(line);
  logPanel.scrollTop = logPanel.scrollHeight;

  // Limit to last 50 lines
  while (logPanel.childNodes.length > 50) {
    logPanel.removeChild(logPanel.firstChild);
  }
}

function toggleHelp() {
  const modal = document.getElementById('helpModal');
  toggleManagedModal(modal);
}
function closeHelp(e) {
  const modal = document.getElementById('helpModal');
  if (e.target === modal) {
    closeManagedModal(modal);
  }
}

// Lyrics Sync Workflow State
const lyricsModal = document.getElementById('lyricsModal');
const lyricsSongSelect = document.getElementById('lyricsSongSelect');
const lyricsRawText = document.getElementById('lyricsRawText');
const lyricsStepInput = document.getElementById('lyricsStepInput');
const lyricsStepSync = document.getElementById('lyricsStepSync');
const lyricsStepEdit = document.getElementById('lyricsStepEdit');

const lyricsSyncSongTitle = document.getElementById('lyricsSyncSongTitle');
const lyricsSyncTimecode = document.getElementById('lyricsSyncTimecode');
const lyricsSyncActiveLine = document.getElementById('lyricsSyncActiveLine');
const lyricsSyncUpcomingLines = document.getElementById('lyricsSyncUpcomingLines');
const btnSaveSyncLyrics = document.getElementById('btnSaveSyncLyrics');
const btnLyricsTap = document.getElementById('btnLyricsTap');

const lyricsEditSongTitle = document.getElementById('lyricsEditSongTitle');
const lyricsEditList = document.getElementById('lyricsEditList');
const lyricsEditEmpty = document.getElementById('lyricsEditEmpty');
const btnSaveEditedLyrics = document.getElementById('btnSaveEditedLyrics');
const lyricsDirtyBadge = document.getElementById('lyricsDirtyBadge');

let isLyricsSyncing = false;
let lyricsLinesToSync = [];
let lyricsSyncedLines = [];
let lyricsSyncActiveIndex = 0;

// Visual editor state
let lyricsEditLines = []; // [{timestamp, text}]
let lyricsEditDirty = false;
let lyricsEditLastLoadedSong = '';
let lyricsEditActiveTab = 'create';
let lyricsSelectedSong = '';
const lyricsCreateDrafts = new Map();
const lyricsSaveTracker = controllerRuntime.createPendingCommandTracker({
  timeoutMs: 8_000,
  onSettled: handleLyricsSaveSettled,
});
const TAB_BUTTONS = {
  create: document.getElementById('lyricsTabCreate'),
  sync: document.getElementById('lyricsTabSync'),
  edit: document.getElementById('lyricsTabEdit'),
};
const NO_TIMESTAMP = '[--:--.--]';

function activeSongTitle() {
  const index = lastState?.activeSongIndex;
  if (!Number.isInteger(index) || index < 0) return '';
  return lastState.songs?.[index]?.title || '';
}

lyricsRawText.addEventListener('input', () => {
  const song = lyricsSongSelect.value;
  if (!song) return;
  lyricsCreateDrafts.set(song, { text: lyricsRawText.value, dirty: true });
});

function switchLyricsTab(tab) {
  if (!['create', 'sync', 'edit'].includes(tab)) return;
  // Warn if leaving Edit with unsaved changes
  if (lyricsEditActiveTab === 'edit' && tab !== 'edit' && lyricsEditDirty) {
    if (!confirm(t('lyrics.discardTab'))) return;
  }
  lyricsEditActiveTab = tab;
  lyricsStepInput.style.display = tab === 'create' ? 'block' : 'none';
  lyricsStepSync.style.display = tab === 'sync' ? 'block' : 'none';
  lyricsStepEdit.style.display = tab === 'edit' ? 'block' : 'none';
  for (const [key, btn] of Object.entries(TAB_BUTTONS)) {
    if (!btn) continue;
    const isActive = key === tab;
    btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
    btn.style.color = isActive ? 'var(--accent)' : 'var(--text-muted)';
  }
  if (tab === 'edit') {
    refreshLyricsEditor();
  } else if (tab === 'sync') {
    lyricsSyncSongTitle.textContent = lyricsSongSelect.value || '—';
  }
}

function markLyricsDirty(dirty) {
  lyricsEditDirty = !!dirty;
  if (lyricsDirtyBadge) {
    lyricsDirtyBadge.style.display = dirty ? 'inline-block' : 'none';
  }
  if (btnSaveEditedLyrics) {
    btnSaveEditedLyrics.disabled = !dirty || lyricsSaveTracker.hasKind('edit');
  }
}

function lyricsSaveCommandId(kind) {
  return `lyrics-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function canPersistLyrics() {
  return Boolean(
    isController
    && isSynchronized
    && ws
    && ws.readyState === WebSocket.OPEN
  );
}

function beginLyricsSave(kind, message, metadata) {
  if (!canPersistLyrics()) {
    showToast(t(isController ? 'lyrics.notConnected' : 'lyrics.readOnlySave'), 'error');
    return false;
  }
  const commandId = lyricsSaveCommandId(kind);
  if (!lyricsSaveTracker.begin({ commandId, kind, metadata })) return false;

  if (kind === 'edit') markLyricsDirty(lyricsEditDirty);
  if (kind === 'sync') btnSaveSyncLyrics.disabled = true;
  try {
    ws.send(JSON.stringify({ ...message, commandId }));
    return true;
  } catch {
    lyricsSaveTracker.settle({ commandId, status: 'failed' });
    return false;
  }
}

function handleLyricsSaveSettled(entry, status) {
  const confirmed = status === 'confirmed';
  if (entry.kind === 'edit') {
    if (confirmed) {
      markLyricsDirty(false);
      appendLog(t('lyrics.saved', entry.metadata), 'info');
    } else {
      markLyricsDirty(true);
      showToast(t('lyrics.saveFailed'), 'error');
      appendLog(t('lyrics.saveFailed'), 'error');
    }
    return;
  }

  btnSaveSyncLyrics.disabled = lyricsSyncActiveIndex < lyricsLinesToSync.length;
  if (confirmed) {
    appendLog(t('lyrics.syncSaved', entry.metadata), 'info');
    toggleLyricsModal();
  } else {
    showToast(t('lyrics.saveFailed'), 'error');
    appendLog(t('lyrics.saveFailed'), 'error');
  }
}

function refreshLyricsEditor() {
  if (!lyricsSongSelect) return;
  const song = lyricsSongSelect.value;
  if (lyricsEditLastLoadedSong !== song) {
    loadLyricsEditFromServer(song);
    return;
  }
  lyricsEditSongTitle.textContent = song || '—';
  renderLyricsEditList();
}

function loadLyricsEditFromServer(song) {
  lyricsSelectedSong = song || '';
  lyricsSyncSongTitle.textContent = lyricsSelectedSong || '—';
  lyricsEditSongTitle.textContent = lyricsSelectedSong || '—';
  const draft = lyricsCreateDrafts.get(lyricsSelectedSong);
  lyricsRawText.value = draft?.text || '';
  lyricsEditLastLoadedSong = lyricsSelectedSong;
  lyricsEditLines = [];
  markLyricsDirty(false);
  renderLyricsEditList();
  if (!lyricsSelectedSong) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast(t('lyrics.notConnected'), 'error');
    return;
  }
  ws.send(JSON.stringify({ type: 'get_lyrics', song: lyricsSelectedSong }));
}

function applyLyricsLoadToEditor(payload) {
  // Called from ws.onmessage when lyrics event matches current edit song
  if (!payload || payload.type !== 'lyrics') return;
  const song = lyricsSongSelect.value;
  if (payload.song !== song || lyricsEditLastLoadedSong !== song) return;
  if (lyricsEditDirty) return; // do not clobber edits
  const draft = lyricsCreateDrafts.get(song);
  if (!draft?.dirty) {
    const text = (Array.isArray(payload.lines) ? payload.lines : [])
      .map((line) => line.text || '')
      .join('\n');
    lyricsCreateDrafts.set(song, { text, dirty: false });
    lyricsRawText.value = text;
  }
  lyricsEditLines = (Array.isArray(payload.lines) ? payload.lines : [])
    .map((line) => ({
      timestamp: typeof line.time === 'number' && line.time >= 0 ? formatSecondsToLrcTime(line.time) : NO_TIMESTAMP,
      text: line.text || '',
    }));
  markLyricsDirty(false);
  renderLyricsEditList();
}

function renderLyricsEditList() {
  if (!lyricsEditList) return;
  lyricsEditList.innerHTML = '';
  if (!lyricsEditLines.length) {
    lyricsEditEmpty.style.display = 'block';
    lyricsEditList.style.display = 'none';
    return;
  }
  lyricsEditEmpty.style.display = 'none';
  lyricsEditList.style.display = 'flex';
  lyricsEditLines.forEach((line, idx) => {
    const card = document.createElement('div');
    card.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 0.4rem 0.6rem;';
    const hasTs = line.timestamp !== NO_TIMESTAMP;
    const dimStyle = hasTs ? '' : 'color: var(--text-muted); opacity: 0.7;';
    card.innerHTML = `
      <span class="lyric-edit-ts" data-idx="${idx}" style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: ${hasTs ? 'var(--accent)' : '#fbbf24'}; background: rgba(0,0,0,0.3); padding: 0.2rem 0.4rem; border-radius: 4px; min-width: 78px; text-align: center; cursor: text; ${dimStyle}">${escapeLyricsEditorText(line.timestamp)}</span>
      <span class="lyric-edit-text" data-idx="${idx}" style="flex: 1; font-size: 0.9rem; line-height: 1.3; cursor: text; user-select: text;">${escapeLyricsEditorText(line.text) || `<em style="color: var(--text-muted);">${escapeLyricsEditorText(t('common.empty'))}</em>`}</span>
      <button class="lyric-edit-del" data-idx="${idx}" title="${escapeLyricsEditorText(t('common.removeLine'))}" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 1rem; padding: 0.2rem 0.4rem; opacity: 0.6; transition: opacity 0.15s;">&times;</button>
    `;
    lyricsEditList.appendChild(card);
  });
  // Wire double-click to edit, click X to delete
  lyricsEditList.querySelectorAll('.lyric-edit-text').forEach((el) => {
    el.addEventListener('dblclick', (e) => {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      beginInlineLyricEdit(idx, el);
    });
  });
  lyricsEditList.querySelectorAll('.lyric-edit-ts').forEach((el) => {
    el.addEventListener('dblclick', (e) => {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      beginInlineLyricTsEdit(idx, el);
    });
  });
  lyricsEditList.querySelectorAll('.lyric-edit-del').forEach((el) => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      removeLyricLine(idx);
    });
  });
}

function escapeLyricsEditorText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function beginInlineLyricEdit(idx, el) {
  const original = lyricsEditLines[idx];
  if (!original) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = original.text;
  input.style.cssText = 'flex: 1; background: rgba(0,0,0,0.4); border: 1px solid var(--accent); border-radius: 6px; color: var(--text); font-family: inherit; font-size: 0.9rem; padding: 0.3rem 0.5rem; outline: none;';
  el.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const newText = input.value;
    lyricsEditLines[idx] = { ...original, text: newText };
    markLyricsDirty(true);
    renderLyricsEditList();
  };
  const cancel = () => {
    renderLyricsEditList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

function beginInlineLyricTsEdit(idx, el) {
  const original = lyricsEditLines[idx];
  if (!original) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = original.timestamp === NO_TIMESTAMP ? '' : original.timestamp;
  input.placeholder = '[mm:ss.xx]';
  input.style.cssText = 'width: 78px; font-family: \'JetBrains Mono\', monospace; font-size: 0.7rem; background: rgba(0,0,0,0.4); border: 1px solid var(--accent); border-radius: 4px; color: var(--text); padding: 0.2rem 0.3rem; text-align: center; outline: none; box-sizing: border-box;';
  el.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    let val = input.value.trim();
    if (val === '') {
      val = NO_TIMESTAMP;
    } else {
      if (!val.startsWith('[')) val = '[' + val;
      if (!val.endsWith(']')) val = val + ']';
      const regex = /^\[\d{2,3}:\d{2}(\.\d{1,3})?\]$/;
      if (!regex.test(val) && val !== NO_TIMESTAMP) {
        showToast(t('lyrics.invalidTimecode'), 'error');
        renderLyricsEditList();
        return;
      }
    }
    lyricsEditLines[idx] = { ...original, timestamp: val };
    markLyricsDirty(true);
    renderLyricsEditList();
  };
  const cancel = () => {
    renderLyricsEditList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

function addLyricLine() {
  lyricsEditLines.push({ timestamp: NO_TIMESTAMP, text: '' });
  markLyricsDirty(true);
  renderLyricsEditList();
  // Scroll to bottom and start editing the new line
  setTimeout(() => {
    if (lyricsEditList) lyricsEditList.scrollTop = lyricsEditList.scrollHeight;
    const items = lyricsEditList.querySelectorAll('.lyric-edit-text');
    const last = items[items.length - 1];
    if (last) beginInlineLyricEdit(items.length - 1, last);
  }, 0);
}

function removeLyricLine(idx) {
  if (idx < 0 || idx >= lyricsEditLines.length) return;
  lyricsEditLines.splice(idx, 1);
  markLyricsDirty(true);
  renderLyricsEditList();
}

function saveLyricsEdit() {
  if (!lyricsEditDirty) return;
  const song = lyricsSongSelect.value;
  // Build LRC body: only timestamped lines; editor allows no-ts lines but
  // we still emit them with [00:00.00] (silent lines) so the LRC remains
  // complete. Actually NO — we skip no-ts lines, since the lyrics-parser
  // expects well-formed timestamps. The HUD already filters them out.
  const lrcBody = lyricsEditLines
    .filter((l) => l.timestamp && l.timestamp !== NO_TIMESTAMP)
    .map((l) => `${l.timestamp} ${l.text}`)
    .join('\n');
  const count = lyricsEditLines.filter(l => l.timestamp !== NO_TIMESTAMP).length;
  beginLyricsSave(
    'edit',
    {
      type: 'save_lyrics',
      song,
      text: lrcBody,
    },
    { song, count },
  );
}

function onLyricsSongChange() {
  const nextSong = lyricsSongSelect.value;
  if (nextSong === lyricsSelectedSong) return;
  if (lyricsEditDirty) {
    if (!confirm(t('lyrics.discardSong'))) {
      lyricsSongSelect.value = lyricsSelectedSong;
      return;
    }
  }
  loadLyricsEditFromServer(nextSong);
}

function toggleLyricsModal() {
  toggleManagedModal(lyricsModal, () => {
    const tabToRestore = lyricsEditDirty ? lyricsEditActiveTab : 'create';
    resetLyricsSyncWorkflow();
    populateLyricsSongs();
    switchLyricsTab(tabToRestore);
  });
}

function closeLyricsModal(e) {
  if (e.target === lyricsModal) {
    closeManagedModal(lyricsModal);
  }
}

function populateLyricsSongs() {
  const previousSong = lyricsSelectedSong || lyricsSongSelect.value;
  lyricsSongSelect.innerHTML = '';
  const titles = [];
  if (Array.isArray(lastState?.songs)) {
    lastState.songs.forEach(song => {
      titles.push(song.title);
      const option = document.createElement('option');
      option.value = song.title;
      option.textContent = song.title;
      lyricsSongSelect.appendChild(option);
    });
  }
  const activeTitle = activeSongTitle();
  const preserveUnsavedEdit = lyricsEditDirty && titles.includes(lyricsSelectedSong);
  const selectedSong = preserveUnsavedEdit
    ? lyricsSelectedSong
    : titles.includes(activeTitle)
      ? activeTitle
      : titles.includes(previousSong)
        ? previousSong
        : titles[0] || '';
  lyricsSongSelect.value = selectedSong;
  if (preserveUnsavedEdit) {
    lyricsSyncSongTitle.textContent = selectedSong || '—';
    lyricsEditSongTitle.textContent = selectedSong || '—';
    const draft = lyricsCreateDrafts.get(selectedSong);
    lyricsRawText.value = draft?.text || '';
    renderLyricsEditList();
    return;
  }
  loadLyricsEditFromServer(selectedSong);
}

function startLyricsSyncWorkflow() {
  const rawText = lyricsRawText.value.trim();
  if (!rawText) {
    alert(t('lyrics.enterBeforeStart'));
    return;
  }

  lyricsLinesToSync = rawText.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lyricsLinesToSync.length === 0) {
    alert(t('lyrics.noValidLines'));
    return;
  }

  lyricsSyncedLines = [];
  lyricsSyncActiveIndex = 0;
  isLyricsSyncing = true;
  lyricsSongSelect.disabled = true;

  lyricsSyncSongTitle.textContent = lyricsSongSelect.value;

  updateLyricsSyncUI();

  lyricsStepInput.style.display = 'none';
  lyricsStepSync.style.display = 'block';
}

function resetLyricsSyncWorkflow() {
  if (lyricsSaveTracker.hasKind('sync')) {
    showToast(t('lyrics.savePending'), 'warn');
    return;
  }
  isLyricsSyncing = false;
  lyricsLinesToSync = [];
  lyricsSyncedLines = [];
  lyricsSyncActiveIndex = 0;
  lyricsSongSelect.disabled = false;

  btnLyricsTap.disabled = false;
  btnLyricsTap.textContent = t('lyrics.markNow');
  btnSaveSyncLyrics.disabled = true;

  lyricsStepInput.style.display = 'block';
  lyricsStepSync.style.display = 'none';
  lyricsSyncSongTitle.textContent = lyricsSongSelect.value || '—';
}

function getEstimatedSeconds() {
  if (!lastState) return 0;
  if (!lastState.isPlaying) return lastState.currentSongTime * 60 / lastState.tempo;
  const elapsedMs = (performance.now() - lastReceivedTime) + latencyCompensationMs;
  const elapsedBeats = (elapsedMs / 1000) * (lastState.tempo / 60);
  return (lastState.currentSongTime + elapsedBeats) * 60 / lastState.tempo;
}

function tapLyricTime() {
  if (!isLyricsSyncing || lyricsSyncActiveIndex >= lyricsLinesToSync.length) return;

  const absoluteSeconds = getEstimatedSeconds();
  let relativeSeconds = absoluteSeconds;
  if (lastState && lastState.songs) {
    const selectedTitle = lyricsSongSelect.value;
    const song = lastState.songs.find(s => s.title === selectedTitle);
    if (song) {
      const bpm = lastState.tempo || 120;
      const songStartSeconds = song.time * 60 / bpm;
      relativeSeconds = Math.max(0, absoluteSeconds - songStartSeconds);
    }
  }
  const timestamp = formatSecondsToLrcTime(relativeSeconds);
  const lineText = lyricsLinesToSync[lyricsSyncActiveIndex];

  lyricsSyncedLines.push({ timestamp, text: lineText });
  lyricsSyncActiveIndex++;

  updateLyricsSyncUI();

  if (lyricsSyncActiveIndex >= lyricsLinesToSync.length) {
    btnLyricsTap.disabled = true;
    btnLyricsTap.textContent = t('lyrics.allMarked');
    btnSaveSyncLyrics.disabled = false;
    btnSaveSyncLyrics.classList.add('glow');
  }
}

function updateLyricsSyncUI() {
  if (lyricsSyncActiveIndex < lyricsLinesToSync.length) {
    lyricsSyncActiveLine.textContent = lyricsLinesToSync[lyricsSyncActiveIndex];

    const upcoming = lyricsLinesToSync.slice(lyricsSyncActiveIndex + 1);
    lyricsSyncUpcomingLines.innerHTML = upcoming.map((line, idx) => `<div>${idx + 1}. ${escapeLyricsEditorText(line)}</div>`).join('');
  } else {
    lyricsSyncActiveLine.textContent = t('lyrics.end');
    lyricsSyncUpcomingLines.innerHTML = `<div style="font-style: italic; color: var(--success);">${escapeLyricsEditorText(t('lyrics.readySave'))}</div>`;
  }
}

function saveSyncLyrics() {
  const selectedSong = lyricsSongSelect.value;
  const fileContent = lyricsSyncedLines.map(l => `${l.timestamp} ${l.text}`).join('\n');

  beginLyricsSave(
    'sync',
    {
      type: 'save_lyrics',
      song: selectedSong,
      text: fileContent
    },
    { song: selectedSong },
  );
}

// Bind spacebar key for tapping
window.addEventListener('keydown', (e) => {
  if (isLyricsSyncing && e.key === ' ' && document.activeElement !== lyricsRawText) {
    e.preventDefault();
    tapLyricTime();
  }
});

function promptForToken() {
  const currentToken = localStorage.getItem('setlist_token') || '';
  const input = prompt(t('feedback.tokenPrompt'), currentToken);
  if (input !== null) {
    localStorage.setItem('setlist_token', input.trim());
    appendLog(t('feedback.tokenUpdated'), 'info');
    if (ws) {
      ws.close();
    }
  }
}

i18n.subscribe(() => {
  updateLockVisuals();
  renderMidiMappings();
  renderProfileState();
  lastRenderedSongsJson = '';
  if (lastState) renderSongList(lastState);
  renderActiveLyric();
  if (isLyricsSyncing) updateLyricsSyncUI();
  if (document.getElementById('networkErrorOverlay').classList.contains('visible')) {
    showConnectionFailure();
  } else if (ws?.readyState === WebSocket.OPEN) {
    statusText.textContent = t(isController ? 'status.connected' : 'status.readOnly');
  }
});

globalThis.setlistStageRuntime = StageRuntime.mount({ i18n });
mountTransportControls();
connect();
