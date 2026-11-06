import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNetworkPanelModel,
  buildPanelModel,
  panelJson,
  readBridgeState,
} from '../src/ui/panel-model.ts';
import { buildProjectPanelModel } from '../src/ui/panel-project.ts';

const SONGS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function stateWithManager(overrides = {}) {
  return {
    manager: {
      getState: () => ({
        songs: SONGS,
        isPlaying: false,
        tempo: 128,
        activeSongIndex: 1,
        totalDurationSeconds: 754,
        durationConfidence: 'exact',
      }),
    },
    profileManager: {
      list: () => [
        { id: 'one', name: 'Main Setlist' },
        { id: 'two', name: 'Festival' },
      ],
    },
    projectIdentity: { displayName: 'Summer Tour' },
    profileScopeSwitching: false,
    ...overrides,
  };
}

test('a machine that holds no manager opens an empty panel', () => {
  const view = readBridgeState(undefined);
  assert.equal(view.managerPresent, false);
  assert.equal(view.profileManagerPresent, false);
  assert.equal(view.songCount, 0);
  assert.equal(view.durationSeconds, null);
  assert.equal(view.profiles.length, 0);
  assert.equal(view.projectName, '');
  assert.equal(view.durationConfidence, 'estimated');

  const empty = readBridgeState({});
  assert.equal(empty.managerPresent, false);
  assert.equal(empty.isPlaying, false);
  assert.equal(empty.projectName, '');
});

test('the panel reads what the manager is doing', () => {
  const view = readBridgeState(stateWithManager());
  assert.equal(view.managerPresent, true);
  assert.equal(view.isPlaying, false);
  assert.equal(view.songCount, 3);
  assert.equal(view.durationSeconds, 754);
  assert.equal(view.tempo, 128);
  assert.equal(view.durationConfidence, 'exact');
  assert.equal(view.projectName, 'Summer Tour');
  assert.deepEqual(
    view.profiles.map((profile) => profile.name),
    ['Main Setlist', 'Festival'],
  );
});

test('a manager that throws does not take the panel down', () => {
  const state = stateWithManager({
    manager: {
      getState: () => {
        throw new Error('Live is busy');
      },
    },
  });
  const view = readBridgeState(state);
  assert.equal(view.managerPresent, true);
  assert.equal(view.songCount, 0);
  assert.equal(view.isPlaying, false);
});

test('the payload of the profile state names the setlist that is active', () => {
  const view = readBridgeState(stateWithManager(), () => ({
    profiles: [{ id: 'one', name: 'Main Setlist' }],
    activeProfileId: 'one',
    canMutate: true,
    projectName: 'Payload Project',
  }));
  assert.equal(view.activeProfileId, 'one');
  assert.equal(view.canMutate, true);
  assert.equal(view.projectName, 'Payload Project');
  assert.equal(view.profiles.length, 1);
});

test('a payload that throws does not take the panel down', () => {
  const view = readBridgeState(stateWithManager(), () => {
    throw new Error('no profile manager');
  });
  assert.equal(view.activeProfileId, null);
  assert.equal(view.profiles.length, 2);
});

test('the setlist is locked while the transport runs', () => {
  const model = buildProjectPanelModel({
    projectName: 'Summer Tour',
    profiles: [{ id: 'one', name: 'Main Setlist' }],
    activeProfileId: 'one',
    canMutate: false,
    isPlaying: true,
    scopeSwitching: false,
    profileManagerPresent: true,
  });
  assert.equal(model.locked, true);
  assert.equal(model.lockReason, 'playing');
});

test('a project being changed is the reason the extension gives first', () => {
  // The extension refuses a request for the change of project before the
  // transport: the page has to name the same reason.
  const model = buildProjectPanelModel({
    projectName: 'Summer Tour',
    profiles: [{ id: 'one', name: 'Main Setlist' }],
    activeProfileId: 'one',
    canMutate: false,
    isPlaying: true,
    scopeSwitching: true,
    profileManagerPresent: true,
  });
  assert.equal(model.lockReason, 'switching');
});

test('a setlist the extension says it cannot change stays locked', () => {
  const model = buildProjectPanelModel({
    projectName: 'Summer Tour',
    profiles: [{ id: 'one', name: 'Main Setlist' }],
    activeProfileId: 'one',
    canMutate: false,
    isPlaying: false,
    scopeSwitching: false,
    profileManagerPresent: true,
  });
  assert.equal(model.locked, true);
  assert.equal(model.lockReason, 'missing');
});

test('the setlist is locked while the project is being changed', () => {
  const model = buildProjectPanelModel({
    projectName: 'Summer Tour',
    profiles: [{ id: 'one', name: 'Main Setlist' }],
    activeProfileId: 'one',
    canMutate: false,
    isPlaying: false,
    scopeSwitching: true,
    profileManagerPresent: true,
  });
  assert.equal(model.locked, true);
  assert.equal(model.lockReason, 'switching');
});

test('a missing profile manager locks the setlist', () => {
  const model = buildProjectPanelModel({
    projectName: '',
    profiles: [],
    activeProfileId: null,
    canMutate: false,
    isPlaying: false,
    scopeSwitching: false,
    profileManagerPresent: false,
  });
  assert.equal(model.locked, true);
  assert.equal(model.lockReason, 'missing');
});

test('a setlist may be chosen when nothing plays', () => {
  const model = buildProjectPanelModel({
    projectName: 'Summer Tour',
    profiles: [{ id: 'one', name: 'Main Setlist' }],
    activeProfileId: 'one',
    canMutate: true,
    isPlaying: false,
    scopeSwitching: false,
    profileManagerPresent: true,
  });
  assert.equal(model.locked, false);
  assert.equal(model.lockReason, null);
});

test('the name of a project cannot break out of the page', () => {
  const written = panelJson({ name: '</script><img src=x onerror=alert(1)>' });
  assert.ok(!written.includes('<'));
  assert.ok(written.includes('\\u003c'));
  assert.deepEqual(JSON.parse(written), {
    name: '</script><img src=x onerror=alert(1)>',
  });
});

test('the panel announces the address that was chosen', () => {
  const model = buildNetworkPanelModel({
    candidates: [
      {
        id: 'Wi-Fi|192.168.1.0/24',
        ip: '192.168.1.50',
        kind: 'wifi',
        interfaceName: 'Wi-Fi',
        subnet: '192.168.1.0/24',
        gateway: '192.168.1.1',
        defaultRoute: true,
        covered: true,
      },
      {
        id: 'Ethernet|192.168.0.0/24',
        ip: '192.168.0.10',
        kind: 'ethernet',
        interfaceName: 'Ethernet',
        subnet: '192.168.0.0/24',
        gateway: null,
        defaultRoute: false,
        covered: false,
      },
    ],
    primaryIp: '192.168.1.50',
    selectedAddress: '192.168.0.10',
    protocol: 'https',
    port: 4444,
    caPort: 4445,
    caAvailable: true,
    tls: true,
  });
  assert.equal(model.announcedIp, '192.168.0.10');
  assert.equal(model.certCoversSelected, false);
  assert.equal(model.candidates.length, 2);
});

test('the automatic address is judged by the certificate too', () => {
  const model = buildNetworkPanelModel({
    candidates: [
      {
        id: 'Wi-Fi|192.168.1.0/24',
        ip: '192.168.1.50',
        kind: 'wifi',
        interfaceName: 'Wi-Fi',
        subnet: '192.168.1.0/24',
        gateway: '192.168.1.1',
        defaultRoute: true,
        covered: true,
      },
    ],
    primaryIp: '192.168.1.50',
    selectedAddress: '',
    protocol: 'https',
    port: 4444,
    caPort: 4445,
    caAvailable: true,
    tls: true,
  });
  assert.equal(model.announcedIp, '192.168.1.50');
  assert.equal(model.certCoversSelected, true);
});

test('a chosen address the certificate covers is said to be covered', () => {
  const model = buildNetworkPanelModel({
    candidates: [
      {
        id: 'Wi-Fi|192.168.1.0/24',
        ip: '192.168.1.50',
        kind: 'wifi',
        interfaceName: 'Wi-Fi',
        subnet: '192.168.1.0/24',
        gateway: '192.168.1.1',
        defaultRoute: true,
        covered: false,
      },
      {
        id: 'Ethernet|192.168.0.0/24',
        ip: '192.168.0.10',
        kind: 'ethernet',
        interfaceName: 'Ethernet',
        subnet: '192.168.0.0/24',
        gateway: null,
        defaultRoute: false,
        covered: true,
      },
    ],
    primaryIp: '192.168.1.50',
    selectedAddress: '192.168.0.10',
    protocol: 'https',
    port: 4444,
    caPort: 4445,
    caAvailable: true,
    tls: true,
  });
  assert.equal(model.announcedIp, '192.168.0.10');
  assert.equal(model.certCoversSelected, true);
});

test('the panel without a network announces nothing', () => {
  const model = buildPanelModel();
  assert.equal(model.network.announcedIp, '');
  assert.equal(model.network.candidates.length, 0);
  assert.equal(model.project.locked, true);
  assert.equal(model.playback.songCount, 0);
  assert.equal(model.tab, 'main');
});
