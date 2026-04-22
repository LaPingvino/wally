import React, { useCallback, useMemo } from 'react';
import { Box, Spinner, Switch, Text } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAccountData } from '../../../hooks/useAccountData';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';

// MSC4155 invite permission config — server-enforced once set, applied
// across clients. Schema we touch:
//   { blocked_servers?: string[], ...other fields preserved }
// "*" in blocked_servers means "block all incoming invites".
type InvitePermissionConfig = {
  default?: 'allow' | 'block';
  allowed_users?: string[];
  blocked_users?: string[];
  allowed_servers?: string[];
  blocked_servers?: string[];
};

export function InviteBlocking() {
  const mx = useMatrixClient();
  const evt = useAccountData(AccountDataEvent.InvitePermissionConfig);

  const content = useMemo<InvitePermissionConfig>(
    () => evt?.getContent<InvitePermissionConfig>() ?? {},
    [evt]
  );
  const allBlocked = (content.blocked_servers ?? []).includes('*');

  const [state, run] = useAsyncCallback(
    useCallback(
      async (next: boolean) => {
        const existing = (content.blocked_servers ?? []).filter((s) => s !== '*');
        const blocked_servers = next ? ['*', ...existing] : existing;
        const updated: InvitePermissionConfig = { ...content, blocked_servers };
        // Drop the field entirely if empty so we don't litter account data
        // with `{"blocked_servers":[]}` after the user toggles off.
        if (blocked_servers.length === 0) delete updated.blocked_servers;
        await mx.setAccountData(AccountDataEvent.InvitePermissionConfig, updated);
      },
      [mx, content]
    )
  );
  const saving = state.status === AsyncStatus.Loading;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Invites</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Block all room invites"
          description="Server-enforced (MSC4155). Invites from anyone will be rejected before they reach you. Setting persists across clients."
          after={
            <Box alignItems="Center" gap="200">
              {saving && <Spinner variant="Secondary" size="200" />}
              <Switch
                variant="Primary"
                value={allBlocked}
                onChange={(v) => run(v)}
                disabled={saving}
              />
            </Box>
          }
        />
      </SequenceCard>
    </Box>
  );
}
