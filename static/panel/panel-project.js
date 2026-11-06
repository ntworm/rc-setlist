/**
 * The setlists tab: the setlists of the project Live has open, and the
 * packages that carry them in and out.
 *
 * Every change is a request. The page disables what cannot be done while
 * the transport runs, and the extension reads the state of Live again
 * before it carries the request out. What it did comes back as a notice.
 */
(function () {
  'use strict';

  const Panel = window.RcPanel;
  const shell = Panel.shell;
  const el = shell.el;

  const ui = { editingId: null, confirmId: null, selectedPackage: null };

  /**
   * The project and its setlists, as the extension reported them.
   */
  function project() {
    return (
      window.INITIAL_PROJECT || {
        projectName: '',
        profiles: [],
        deletedProfiles: [],
        activeProfileId: null,
        canMutate: false,
        locked: true,
        lockReason: 'missing',
      }
    );
  }

  /**
   * The folder of the packages and what is in it.
   */
  function packages() {
    return window.INITIAL_PACKAGES || { dir: '', files: [] };
  }

  /**
   * Why the setlists cannot change right now, or what the tab is for.
   */
  function lockHint(model) {
    if (!model.locked) return shell.text('setlist.activePlays');
    if (model.lockReason === 'playing') return shell.text('setlist.lockedPlaying');
    if (model.lockReason === 'switching') return shell.text('setlist.lockedSwitching');
    if (model.lockReason === 'no-project') return shell.text('setlist.lockedNoProject');
    return shell.text('setlist.lockedMissing');
  }

  /**
   * A button of a row.
   */
  function button(label, onClick, options) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'btn btn-small';
    if (options && options.danger) element.classList.add('is-danger');
    element.textContent = label;
    element.disabled = Boolean(options && options.disabled);
    element.addEventListener('click', onClick);
    return element;
  }

  /**
   * The words beside the name of the active setlist: its songs and its time.
   */
  function activeMeta() {
    const state = window.INITIAL_PLAYBACK || {};
    const songs = shell.text('setlist.songs', { count: String(state.songCount || 0) });
    return `${songs} · ${Panel.main.formatDuration(state.durationSeconds)}`;
  }

  /**
   * The field that renames a setlist.
   */
  function renameField(profile, actions) {
    const input = document.createElement('input');
    input.className = 'text-input';
    input.type = 'text';
    input.maxLength = 80;
    input.value = profile.name;
    input.setAttribute('aria-label', shell.text('setlist.rename'));
    const save = () => {
      const name = input.value.trim();
      if (!name || name === profile.name) {
        ui.editingId = null;
        render();
        return;
      }
      shell.sendAction('rename-profile', { profileId: profile.id, name: name });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') {
        ui.editingId = null;
        render();
      }
    });
    actions.append(
      button(shell.text('setlist.save'), save),
      button(shell.text('setlist.cancel'), () => {
        ui.editingId = null;
        render();
      }),
    );
    setTimeout(() => input.select(), 0);
    return input;
  }

  /**
   * The buttons of a setlist that is not being renamed.
   */
  function rowActions(profile, active, locked, actions) {
    if (ui.confirmId === profile.id) {
      const ask = document.createElement('span');
      ask.className = 'confirm-text';
      ask.textContent = shell.text('setlist.confirmDelete');
      actions.append(
        ask,
        button(
          shell.text('setlist.delete'),
          () => shell.sendAction('delete-profile', { profileId: profile.id, name: profile.name }),
          { danger: true, disabled: locked },
        ),
        button(shell.text('setlist.cancel'), () => {
          ui.confirmId = null;
          render();
        }),
      );
      return;
    }
    if (active) {
      const tag = document.createElement('span');
      tag.className = 'state-tag';
      tag.textContent = shell.text('setlist.activeFlag');
      actions.appendChild(tag);
    } else {
      actions.appendChild(
        button(
          shell.text('setlist.activate'),
          () => shell.sendAction('select-profile', { profileId: profile.id }),
          { disabled: locked },
        ),
      );
    }
    actions.appendChild(
      button(
        shell.text('setlist.rename'),
        () => {
          ui.editingId = profile.id;
          ui.confirmId = null;
          render();
        },
        { disabled: locked },
      ),
    );
    if (!active) {
      actions.appendChild(
        button(
          shell.text('setlist.delete'),
          () => {
            ui.confirmId = profile.id;
            ui.editingId = null;
            render();
          },
          { disabled: locked },
        ),
      );
    }
  }

  /**
   * One setlist of the project, as a row.
   */
  function profileRow(profile, model) {
    const active = profile.id === model.activeProfileId;
    const row = document.createElement('li');
    row.className = 'setlist-row';
    if (active) row.classList.add('is-active');
    const stripe = document.createElement('span');
    stripe.className = 'song-stripe';
    const meta = document.createElement('span');
    meta.className = 'setlist-meta';
    meta.textContent = active ? activeMeta() : '';
    const actions = document.createElement('span');
    actions.className = 'setlist-actions';
    let name;
    if (ui.editingId === profile.id && !model.locked) {
      name = renameField(profile, actions);
    } else {
      name = document.createElement('span');
      name.className = 'setlist-name';
      name.textContent = profile.name;
      rowActions(profile, active, model.locked, actions);
    }
    row.append(stripe, name, meta, actions);
    return row;
  }

  /**
   * The setlists of the project.
   */
  function renderProfiles() {
    const model = project();
    const heading = el('setlistHeading');
    if (heading) {
      heading.textContent = model.projectName
        ? shell.text('setlist.inProject', { project: model.projectName })
        : shell.text('tab.setlist');
    }
    const hint = el('setlistHint');
    if (hint) hint.textContent = lockHint(model);
    const list = el('setlistProfiles');
    if (!list) return;
    list.textContent = '';
    if (!model.profiles.length) {
      const empty = document.createElement('li');
      empty.className = 'song-empty';
      empty.textContent = shell.text('setlist.empty');
      list.appendChild(empty);
    }
    for (const profile of model.profiles) list.appendChild(profileRow(profile, model));
    const createButton = el('btnCreateSetlist');
    const createName = el('setlistCreateName');
    if (createButton) createButton.disabled = model.locked;
    if (createName) {
      createName.disabled = model.locked;
      createName.placeholder = shell.text('setlist.newPlaceholder');
    }
  }

  /**
   * The setlists that were deleted and can come back.
   */
  function renderDeleted() {
    const model = project();
    const deleted = model.deletedProfiles || [];
    const head = el('deletedHead');
    const list = el('deletedProfiles');
    if (head) head.hidden = !deleted.length;
    if (!list) return;
    list.hidden = !deleted.length;
    list.textContent = '';
    for (const profile of deleted) {
      const row = document.createElement('li');
      row.className = 'setlist-row is-deleted';
      const stripe = document.createElement('span');
      stripe.className = 'song-stripe';
      const name = document.createElement('span');
      name.className = 'setlist-name';
      name.textContent = profile.name;
      const meta = document.createElement('span');
      meta.className = 'setlist-meta';
      meta.textContent = profile.deletedAt ? String(profile.deletedAt).slice(0, 10) : '';
      const actions = document.createElement('span');
      actions.className = 'setlist-actions';
      actions.appendChild(
        button(
          shell.text('setlist.restore'),
          () => shell.sendAction('restore-profile', { profileId: profile.id }),
          { disabled: model.locked },
        ),
      );
      row.append(stripe, name, meta, actions);
      list.appendChild(row);
    }
  }

  /**
   * The day a package was written, as the operator reads it.
   */
  function packageDate(time) {
    const date = new Date(time);
    if (isNaN(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  }

  /**
   * One package of the folder, as a row of the list.
   */
  function packageRow(entry) {
    const item = document.createElement('li');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'package-item';
    pick.setAttribute('aria-pressed', entry.file === ui.selectedPackage ? 'true' : 'false');
    const name = document.createElement('span');
    name.textContent = entry.file;
    const date = document.createElement('span');
    date.textContent = packageDate(entry.modifiedAt);
    pick.append(name, date);
    pick.addEventListener('click', () => {
      ui.selectedPackage = entry.file;
      renderPackages();
    });
    item.appendChild(pick);
    return item;
  }

  /**
   * The packages of the folder, listed.
   */
  function renderPackageList(files) {
    const list = el('packageList');
    if (!list) return;
    list.textContent = '';
    if (!files.length) {
      const empty = document.createElement('li');
      empty.className = 'package-empty';
      empty.textContent = shell.text('package.none');
      list.appendChild(empty);
    }
    for (const entry of files) list.appendChild(packageRow(entry));
  }

  /**
   * The buttons that bring a package into the project and out of it.
   */
  function renderPackageButtons(locked) {
    const importButton = el('btnImportPackage');
    if (importButton) importButton.disabled = locked || !ui.selectedPackage;
    const exportButton = el('btnExportPackage');
    if (exportButton) exportButton.disabled = locked || !project().profiles.length;
  }

  /**
   * The packages of the folder, one of them chosen.
   */
  function renderPackages() {
    const model = packages();
    const locked = project().locked;
    const files = model.files || [];
    if (!files.some((entry) => entry.file === ui.selectedPackage)) {
      ui.selectedPackage = files.length ? files[0].file : null;
    }
    renderPackageList(files);
    renderPackageButtons(locked);
    const dir = el('packagesDir');
    if (dir) dir.textContent = model.dir || '—';
    const copy = el('btnCopyPackagesDir');
    if (copy) copy.disabled = !model.dir;
  }

  /**
   * Paints the whole tab.
   */
  function render() {
    renderProfiles();
    renderDeleted();
    renderPackages();
  }

  /**
   * Asks the extension to create a setlist with the name in the field.
   */
  function onCreate(event) {
    event.preventDefault();
    const field = el('setlistCreateName');
    const name = field ? field.value.trim() : '';
    if (!name) {
      if (field) field.focus();
      return;
    }
    shell.sendAction('create-profile', { name: name });
  }

  /**
   * Copies the folder of the packages, so the operator can open it.
   */
  async function onCopyFolder() {
    const copy = el('btnCopyPackagesDir');
    const dir = packages().dir;
    if (!dir || !copy) return;
    const ok = await Panel.copy.copyText(dir);
    copy.textContent = shell.text(ok ? 'package.copied' : 'package.copyFailed');
    setTimeout(() => {
      copy.textContent = shell.text('package.copyPath');
    }, 1600);
  }

  /**
   * Wires the tab to the page.
   */
  function bind() {
    const form = el('setlistCreate');
    if (form) form.addEventListener('submit', onCreate);
    const exportButton = el('btnExportPackage');
    if (exportButton) {
      exportButton.addEventListener('click', () => shell.sendAction('export-package'));
    }
    const importButton = el('btnImportPackage');
    if (importButton) {
      importButton.addEventListener('click', () => {
        if (ui.selectedPackage) {
          shell.sendAction('import-package', { packageFile: ui.selectedPackage });
        }
      });
    }
    const copy = el('btnCopyPackagesDir');
    if (copy) copy.addEventListener('click', onCopyFolder);
  }

  Panel.project = { bind: bind, render: render };
})();
