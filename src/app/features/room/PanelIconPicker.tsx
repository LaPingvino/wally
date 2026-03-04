import React, { useState, useMemo } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { Box, Icon, Icons, IconSrc, Text, config, color } from 'folds';
import { mxcUrlToHttp } from '../../utils/matrix';

type PanelIconPickerProps = {
  onSelect: (iconSpec: string | undefined) => void;
  onClose: () => void;
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `${config.space.S100} ${config.space.S200}`,
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: '6px',
  background: 'var(--bg-surface)',
  color: 'var(--tc-surface-high)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const ALL_ICONS = Object.entries(Icons) as [string, IconSrc][];

export function PanelIconPicker({ onSelect, onClose }: PanelIconPickerProps) {
  const [search, setSearch] = useState('');
  const [customInput, setCustomInput] = useState('');

  const filteredIcons = useMemo(
    () =>
      search
        ? ALL_ICONS.filter(([name]) => name.toLowerCase().includes(search.toLowerCase()))
        : ALL_ICONS,
    [search]
  );

  const handleCustomApply = () => {
    const val = customInput.trim();
    if (!val) return;
    if (val.startsWith('mxc://')) {
      onSelect(val);
    } else {
      onSelect(`emoji:${val}`);
    }
  };

  return (
    <Box
      direction="Column"
      gap="200"
      style={{
        padding: config.space.S300,
        background: 'var(--bg-surface)',
        border: `1px solid ${color.Surface.ContainerLine}`,
        borderRadius: '8px',
        width: '260px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
      }}
    >
      <Box alignItems="Center" justifyContent="SpaceBetween">
        <Text size="L400">Pick Icon</Text>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          aria-label="Close icon picker"
        >
          <Icon src={Icons.Cross} size="100" />
        </button>
      </Box>

      {/* Emoji or mxc:// custom input */}
      <Box gap="100" alignItems="Center">
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="Emoji or mxc:// URL"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCustomApply(); }}
        />
        <button
          type="button"
          onClick={handleCustomApply}
          disabled={!customInput.trim()}
          style={{
            padding: `${config.space.S100} ${config.space.S200}`,
            border: `1px solid ${color.Surface.ContainerLine}`,
            borderRadius: '6px',
            background: 'var(--bg-primary)',
            color: 'var(--tc-primary-high)',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Use
        </button>
      </Box>

      {/* Search box for folds icons */}
      <input
        style={inputStyle}
        placeholder="Search icons…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      {/* Icon grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 4,
          maxHeight: 200,
          overflowY: 'auto',
          padding: 2,
        }}
      >
        {filteredIcons.map(([name, src]) => (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() => onSelect(`icons:${name}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              border: '1px solid transparent',
              borderRadius: '6px',
              background: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface-hover, rgba(0,0,0,0.06))';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'none';
            }}
          >
            <Icon src={src as IconSrc} size="100" />
          </button>
        ))}
        {filteredIcons.length === 0 && (
          <Text size="T200" style={{ gridColumn: '1/-1', padding: config.space.S100, color: 'var(--tc-surface-low)' }}>
            No icons found
          </Text>
        )}
      </div>

      {/* Clear button */}
      <button
        type="button"
        onClick={() => onSelect(undefined)}
        style={{
          padding: `${config.space.S100} ${config.space.S200}`,
          border: `1px solid ${color.Surface.ContainerLine}`,
          borderRadius: '6px',
          background: 'none',
          cursor: 'pointer',
          fontSize: '13px',
          color: 'var(--tc-surface-high)',
          width: '100%',
        }}
      >
        Clear (use name initial)
      </button>
    </Box>
  );
}

/**
 * Renders an icon for a toolbar item based on its iconSpec string.
 * - undefined / null → name initial letter
 * - 'icons:CategoryName' → folds Icon component
 * - 'mxc://...' → img tag via mxcUrlToHttp
 * - 'emoji:🧩' or bare character → inline span
 */
export function renderItemIcon(
  iconSpec: string | undefined,
  nameInitial: string,
  mx: MatrixClient,
  useAuth: boolean
): React.ReactNode {
  if (!iconSpec) {
    return <Text size="T200">{nameInitial[0]?.toUpperCase() ?? '?'}</Text>;
  }
  if (iconSpec.startsWith('icons:')) {
    const key = iconSpec.slice(6) as keyof typeof Icons;
    const src = Icons[key] as IconSrc | undefined;
    return src ? <Icon src={src} size="200" /> : <Text size="T200">{nameInitial[0]}</Text>;
  }
  if (iconSpec.startsWith('mxc://')) {
    const url = mxcUrlToHttp(mx, iconSpec, useAuth, 20, 20, 'crop');
    return url ? (
      <img src={url} alt="" style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 2 }} />
    ) : (
      <Text size="T200">{nameInitial[0]}</Text>
    );
  }
  const char = iconSpec.startsWith('emoji:') ? iconSpec.slice(6) : iconSpec;
  return <span style={{ fontSize: 14, lineHeight: 1 }}>{char}</span>;
}
