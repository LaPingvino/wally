import React, { KeyboardEventHandler, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Input,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
} from 'folds';
import { activePersonaAtom, savedPersonasAtom, Persona } from '../../state/personas';
import { stopPropagation } from '../../utils/keyboard';
import { useMatrixClient } from '../../hooks/useMatrixClient';

function PersonaForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Persona;
  onSave: (p: Persona) => void;
  onCancel: () => void;
}) {
  const mx = useMatrixClient();
  const [name, setName] = useState(initial?.displayname ?? '');
  const [avatar, setAvatar] = useState(initial?.avatar_url ?? '');
  const [pronouns, setPronouns] = useState(initial?.pronouns ?? '');
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
    onSave({ displayname, avatar_url: avatar.trim() || undefined, pronouns: pronouns.trim() || undefined });
  };

  const onKeyDown: KeyboardEventHandler = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <Box direction="Column" gap="200" style={{ padding: config.space.S100 }}>
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
      <Box gap="200">
        <IconButton size="300" variant="Primary" radii="300" onClick={save} aria-label="Save" disabled={uploading}>
          <Icon src={Icons.Check} />
        </IconButton>
        <IconButton size="300" variant="Surface" radii="300" onClick={onCancel} aria-label="Cancel">
          <Icon src={Icons.Cross} />
        </IconButton>
      </Box>
    </Box>
  );
}

export function PersonaPicker() {
  const [activePersona, setActivePersona] = useAtom(activePersonaAtom);
  const [savedPersonas, setSavedPersonas] = useAtom(savedPersonasAtom);
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);

  const openMenu = (evt: React.MouseEvent<HTMLButtonElement>) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };
  const closeMenu = () => {
    setMenuCords(undefined);
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
    // Add to saved list (avoid exact duplicates)
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
    // Update active persona if we just edited the active one
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

  const isActive = !!activePersona;

  return (
    <>
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
            <Menu style={{ minWidth: '220px', maxWidth: '300px' }}>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
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
                {savedPersonas.map((p, i) =>
                  editIdx === i ? (
                    // eslint-disable-next-line react/no-array-index-key
                    <PersonaForm
                      key={i}
                      initial={p}
                      onSave={(edited) => handleSaveEdit(i, edited)}
                      onCancel={() => setEditIdx(null)}
                    />
                  ) : (
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
                        <Text size="T300" truncate>
                          {p.displayname}
                        </Text>
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
                  )
                )}

                {/* Add new persona */}
                {addMode ? (
                  <PersonaForm
                    onSave={handleSaveNew}
                    onCancel={() => setAddMode(false)}
                  />
                ) : (
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
                )}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
