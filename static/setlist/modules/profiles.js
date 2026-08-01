// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Profiles UI controller module for Setlist (Task 6.4)

export class ProfileUIController {
  constructor(wsClient) {
    this.ws = wsClient;
  }

  selectProfile(id) {
    if (!id) return;
    this.ws.send({
      type: "profile_select",
      id,
      commandId: `profile-select-${Date.now()}`
    });
  }

  createProfile(name) {
    if (!name || !name.trim()) return;
    this.ws.send({
      type: "profile_create",
      name: name.trim(),
      commandId: `profile-create-${Date.now()}`
    });
  }

  renameProfile(id, newName) {
    if (!id || !newName || !newName.trim()) return;
    this.ws.send({
      type: "profile_rename",
      id,
      name: newName.trim(),
      commandId: `profile-rename-${Date.now()}`
    });
  }

  deleteProfile(id) {
    if (!id) return;
    this.ws.send({
      type: "profile_delete",
      id,
      commandId: `profile-delete-${Date.now()}`
    });
  }

  restoreProfile(id) {
    if (!id) return;
    this.ws.send({
      type: "profile_restore",
      id,
      commandId: `profile-restore-${Date.now()}`
    });
  }

  purgeProfile(id) {
    if (!id) return;
    this.ws.send({
      type: "profile_purge",
      id,
      commandId: `profile-purge-${Date.now()}`
    });
  }
}
