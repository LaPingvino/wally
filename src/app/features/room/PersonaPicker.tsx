import React, { KeyboardEventHandler, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Menu,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  RectCords,
  Text,
  config,
} from 'folds';
import {
  activePersonaAtom,
  savedPersonasAtom,
  prefixStickyAtom,
  Persona,
  exportPersonasToPluralKit,
  importPersonasFromJson,
} from '../../state/personas';
import { stopPropagation } from '../../utils/keyboard';
import { useMatrixClient } from '../../hooks/useMatrixClient';

function PrefixList({
  prefixes,
  onChange,
}: {
  prefixes: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || prefixes.includes(trimmed)) return;
    onChange([...prefixes, trimmed]);
    setInput('');
  };

  const onKeyDown: KeyboardEventHandler = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  };

  return (
    <Box direction="Column" gap="100">
      {prefixes.map((pfx) => (
        <Box key={pfx} gap="100" alignItems="Center">
          <Text
            size="T200"
            style={{
              flexGrow: 1,
              fontFamily: 'monospace',
              background: 'var(--mx-surface-variant-container)',
              borderRadius: config.radii.R300,
              padding: `${config.space.S100} ${config.space.S200}`,
            }}
          >
            {pfx}
          </Text>
          <IconButton
            size="300"
            variant="SurfaceVariant"
            radii="300"
            onClick={() => onChange(prefixes.filter((p) => p !== pfx))}
            aria-label={`Remove prefix ${pfx}`}
          >
            <Icon size="100" src={Icons.Cross} />
          </IconButton>
        </Box>
      ))}
      <Box gap="100" alignItems="Center">
        <Input
          style={{ flexGrow: 1 }}
          size="300"
          placeholder="Add prefix (e.g. A:)"
          value={input}
          onChange={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
        />
        <IconButton
          size="300"
          variant="SurfaceVariant"
          radii="300"
          onClick={add}
          aria-label="Add prefix"
          disabled={!input.trim()}
        >
          <Icon size="100" src={Icons.Plus} />
        </IconButton>
      </Box>
    </Box>
  );
}

function PersonaForm({
  initial,
  title,
  onSave,
  onCancel,
}: {
  initial?: Persona;
  title: string;
  onSave: (p: Persona) => void;
  onCancel: () => void;
}) {
  const mx = useMatrixClient();
  const [name, setName] = useState(initial?.displayname ?? '');
  const [avatar, setAvatar] = useState(initial?.avatar_url ?? '');
  const [pronouns, setPronouns] = useState(initial?.pronouns ?? '');
  const [prefixes, setPrefixes] = useState<string[]>(initial?.prefixes ?? []);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadAndSetMxc = async (blob: Blob, filename: string) => {
    setUploading(true);
    try {
      const result = await mx.uploadContent(blob, { name: filename, type: blob.type });
      if (result.content_uri) setAvatar(result.content_uri);
    } catch {
      // leave avatar unchanged on error
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    uploadAndSetMxc(file, file.name);
  };

  // On blur of the URL field, convert https:// to mxc:// by fetching + uploading
  const handleAvatarBlur = async () => {
    const url = avatar.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) return;
    setUploading(true);
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const filename = url.split('/').pop()?.split('?')[0] ?? 'avatar';
      const result = await mx.uploadContent(blob, { name: filename, type: blob.type });
      if (result.content_uri) setAvatar(result.content_uri);
    } catch {
      // leave as-is if fetch/upload fails
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    const displayname = name.trim();
    if (!displayname) return;
    onSave({
      displayname,
      avatar_url: avatar.trim() || undefined,
      pronouns: pronouns.trim() || undefined,
      prefixes: prefixes.length > 0 ? prefixes : undefined,
    });
  };

  const onKeyDown: KeyboardEventHandler = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <Dialog
      role="dialog"
      aria-modal="true"
      aria-label={title}
      variant="Surface"
      style={{ width: '90vw', maxWidth: '360px' }}
    >
      <Header
        variant="Surface"
        size="400"
        style={{
          padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: 'var(--mx-surface-container-line)',
        }}
      >
        <Box grow="Yes">
          <Text size="H5" as="h2">{title}</Text>
        </Box>
        <IconButton size="300" radii="300" onClick={onCancel} aria-label="Cancel">
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box direction="Column" gap="200" style={{ padding: config.space.S300 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <Input
          size="300"
          placeholder="Display name"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <Box gap="200" alignItems="Center">
          <Input
            style={{ flexGrow: 1 }}
            size="300"
            placeholder={uploading ? 'Uploading…' : 'Avatar URL (mxc://, optional)'}
            value={uploading ? '' : avatar}
            readOnly={uploading}
            onChange={(e) => setAvatar((e.target as HTMLInputElement).value)}
            onBlur={handleAvatarBlur}
            onKeyDown={onKeyDown}
          />
          <IconButton
            size="300"
            variant="SurfaceVariant"
            radii="300"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload avatar image"
            title="Upload image"
            disabled={uploading}
          >
            <Icon src={Icons.Attachment} size="100" />
          </IconButton>
        </Box>
        <Input
          size="300"
          placeholder="Pronouns (optional, e.g. they/them)"
          value={pronouns}
          onChange={(e) => setPronouns((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
        />
        <Text size="T200" style={{ opacity: 0.7 }}>Prefixes (trigger words to activate this persona):</Text>
        <PrefixList prefixes={prefixes} onChange={setPrefixes} />
        <Box gap="200" justifyContent="End" style={{ paddingTop: config.space.S100 }}>
          <IconButton size="300" variant="Surface" radii="300" onClick={onCancel} aria-label="Cancel">
            <Icon src={Icons.Cross} />
          </IconButton>
          <IconButton size="300" variant="Primary" radii="300" onClick={save} aria-label="Save" disabled={uploading || !name.trim()}>
            <Icon src={Icons.Check} />
          </IconButton>
        </Box>
      </Box>
    </Dialog>
  );
}

export function PersonaPicker() {
  const mx = useMatrixClient();
  const [activePersona, setActivePersona] = useAtom(activePersonaAtom);
  const [savedPersonas, setSavedPersonas] = useAtom(savedPersonasAtom);
  const [prefixSticky, setPrefixSticky] = useAtom(prefixStickyAtom);
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const openMenu = (evt: React.MouseEvent<HTMLButtonElement>) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };
  const closeMenu = () => {
    setMenuCords(undefined);
    setAddMode(false);
    setEditIdx(null);
  };
  const closeForm = () => {
    setAddMode(false);
    setEditIdx(null);
  };

  const activate = (p: Persona) => {
    setActivePersona(p);
    closeMenu();
  };
  const deactivate = () => {
    setActivePersona(null);
    closeMenu();
  };

  const handleSaveNew = (p: Persona) => {
    if (!savedPersonas.some((s) => s.displayname === p.displayname)) {
      setSavedPersonas([...savedPersonas, p]);
    }
    setActivePersona(p);
    setAddMode(false);
    closeMenu();
  };

  const handleSaveEdit = (idx: number, p: Persona) => {
    const updated = savedPersonas.map((s, i) => (i === idx ? p : s));
    setSavedPersonas(updated);
    if (activePersona?.displayname === savedPersonas[idx].displayname) {
      setActivePersona(p);
    }
    setEditIdx(null);
  };

  const deletePersona = (idx: number) => {
    const p = savedPersonas[idx];
    setSavedPersonas(savedPersonas.filter((_, i) => i !== idx));
    if (activePersona?.displayname === p.displayname) setActivePersona(null);
  };

  const handleExport = () => {
    const json = exportPersonasToPluralKit(savedPersonas);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'personas.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = importPersonasFromJson(reader.result as string);
        if (imported.length === 0) return;
        // Upload any HTTPS avatar URLs to mxc://
        const uploaded = await Promise.all(
          imported.map(async (p) => {
            if (!p.avatar_url) return p;
            if (!p.avatar_url.startsWith('http://') && !p.avatar_url.startsWith('https://')) return p;
            try {
              const resp = await fetch(p.avatar_url);
              const blob = await resp.blob();
              const filename = p.avatar_url.split('/').pop()?.split('?')[0] ?? 'avatar';
              const result = await mx.uploadContent(blob, { name: filename, type: blob.type });
              return { ...p, avatar_url: result.content_uri ?? p.avatar_url };
            } catch {
              return { ...p, avatar_url: undefined };
            }
          })
        );
        // Merge: add personas not already present (by displayname)
        const merged = [...savedPersonas];
        uploaded.forEach((p) => {
          if (!merged.some((s) => s.displayname === p.displayname)) merged.push(p);
        });
        setSavedPersonas(merged);
      } catch {
        // invalid JSON — silently ignore
      }
    };
    reader.readAsText(file);
  };

  const isActive = !!activePersona;
  const formOpen = addMode || editIdx !== null;

  return (
    <>
      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      <IconButton
        aria-label={isActive ? `Persona: ${activePersona.displayname}` : 'Set persona'}
        aria-pressed={isActive}
        variant="SurfaceVariant"
        size="300"
        radii="300"
        onClick={openMenu}
      >
        <Icon src={Icons.User} filled={isActive} />
      </IconButton>
      <PopOut
        anchor={menuCords}
        offset={8}
        position="Top"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: closeMenu,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={{ minWidth: '240px', maxWidth: '320px' }}>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>

                {/* Sticky mode toggle */}
                <Box
                  as="label"
                  gap="200"
                  alignItems="Center"
                  style={{
                    padding: `${config.space.S100} ${config.space.S200}`,
                    cursor: 'pointer',
                    borderRadius: config.radii.R300,
                    background: 'var(--bg-surface-low, rgba(0,0,0,0.05))',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={prefixSticky}
                    onChange={(e) => setPrefixSticky((e.target as HTMLInputElement).checked)}
                    style={{ accentColor: 'var(--bg-primary)' }}
                  />
                  <Box direction="Column">
                    <Text size="T300">Sticky prefix mode</Text>
                    <Text size="T200" style={{ opacity: 0.7 }}>
                      {prefixSticky
                        ? 'Prefix switches persona until \\ (escape) or \\\\ (reset)'
                        : 'Prefix applies to one message only'}
                    </Text>
                  </Box>
                </Box>

                {/* Default profile */}
                <MenuItem
                  size="300"
                  variant={!activePersona ? 'Primary' : 'Surface'}
                  radii="300"
                  onClick={deactivate}
                  before={!activePersona ? <Icon size="100" src={Icons.Check} /> : undefined}
                >
                  <Text size="T300">Default (your profile)</Text>
                </MenuItem>

                {/* Saved personas */}
                {savedPersonas.map((p, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Box key={i} gap="100" alignItems="Center">
                    <MenuItem
                      style={{ flexGrow: 1, minWidth: 0 }}
                      size="300"
                      variant={activePersona?.displayname === p.displayname ? 'Primary' : 'Surface'}
                      radii="300"
                      onClick={() => activate(p)}
                      before={
                        activePersona?.displayname === p.displayname ? (
                          <Icon size="100" src={Icons.Check} />
                        ) : undefined
                      }
                    >
                      <Box direction="Column" style={{ minWidth: 0 }}>
                        <Text size="T300" truncate>{p.displayname}</Text>
                        {(p.prefixes?.length ?? 0) > 0 && (
                          <Text size="T200" style={{ opacity: 0.6, fontFamily: 'monospace' }} truncate>
                            {p.prefixes!.join('  ')}
                          </Text>
                        )}
                      </Box>
                    </MenuItem>
                    <IconButton
                      size="300"
                      variant="SurfaceVariant"
                      radii="300"
                      onClick={() => {
                        setEditIdx(i);
                        setAddMode(false);
                      }}
                      aria-label={`Edit ${p.displayname}`}
                    >
                      <Icon size="100" src={Icons.Pencil} />
                    </IconButton>
                    <IconButton
                      size="300"
                      variant="SurfaceVariant"
                      radii="300"
                      onClick={() => deletePersona(i)}
                      aria-label={`Delete ${p.displayname}`}
                    >
                      <Icon size="100" src={Icons.Delete} />
                    </IconButton>
                  </Box>
                ))}

                {/* Add new persona */}
                <MenuItem
                  size="300"
                  variant="Surface"
                  radii="300"
                  onClick={() => {
                    setAddMode(true);
                    setEditIdx(null);
                  }}
                  before={<Icon size="100" src={Icons.Plus} />}
                >
                  <Text size="T300">Add persona...</Text>
                </MenuItem>

                {/* Import / Export */}
                <Box gap="100">
                  <MenuItem
                    style={{ flexGrow: 1 }}
                    size="300"
                    variant="Surface"
                    radii="300"
                    onClick={() => importFileRef.current?.click()}
                    before={<Icon size="100" src={Icons.Attachment} />}
                  >
                    <Text size="T300">Import (PluralKit JSON)</Text>
                  </MenuItem>
                  <IconButton
                    size="300"
                    variant="SurfaceVariant"
                    radii="300"
                    onClick={handleExport}
                    aria-label="Export personas as PluralKit JSON"
                    title="Export"
                    disabled={savedPersonas.length === 0}
                  >
                    <Icon size="100" src={Icons.Download} />
                  </IconButton>
                </Box>

              </Box>
            </Menu>
          </FocusTrap>
        }
      />

      {/* Persona edit/add form — rendered as modal overlay so mobile keyboard doesn't close it */}
      <Overlay open={formOpen} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: closeForm,
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <span>
              {addMode && (
                <PersonaForm
                  title="Add persona"
                  onSave={handleSaveNew}
                  onCancel={closeForm}
                />
              )}
              {editIdx !== null && savedPersonas[editIdx] && (
                <PersonaForm
                  key={editIdx}
                  title={`Edit: ${savedPersonas[editIdx].displayname}`}
                  initial={savedPersonas[editIdx]}
                  onSave={(edited) => handleSaveEdit(editIdx, edited)}
                  onCancel={closeForm}
                />
              )}
            </span>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </>
  );
}
