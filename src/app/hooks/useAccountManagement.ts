import { useMemo } from 'react';
import { useAuthMetadata } from './useAuthMetadata';

/**
 * MSC4191 account-management actions, resolved against what the server says it
 * supports.
 *
 * The device actions were renamed (`sessions_list`/`session_view`/`session_end`
 * → `devices_list`/`device_view`/`device_delete`) after prototype
 * implementations had already shipped the old spellings — the MSC still lists
 * the old ones as known-used. So neither name is safe on its own: send the old
 * one to a current server, or the new one to a server still on the prototype,
 * and the account-management page ignores the action and drops the user on a
 * generic landing page with nothing to explain why.
 *
 * We therefore send the CURRENT name unless the server advertises only a legacy
 * one. `account_management_actions_supported` is what makes that decidable; when
 * the server publishes no list at all we send the current name, which is both
 * the right default and what an MSC-implementing server expects.
 */
const LEGACY_ACTIONS: Record<string, string[]> = {
  'org.matrix.profile': ['profile'],
  'org.matrix.devices_list': ['org.matrix.sessions_list', 'sessions_list'],
  'org.matrix.device_view': ['org.matrix.session_view', 'session_view'],
  'org.matrix.device_delete': ['org.matrix.session_end', 'session_end'],
};

export const useAccountManagementActions = () => {
  const authMetadata = useAuthMetadata();

  const actions = useMemo(() => {
    const supported = authMetadata?.account_management_actions_supported;
    const pick = (action: string): string => {
      if (!supported || supported.includes(action)) return action;
      return LEGACY_ACTIONS[action]?.find((legacy) => supported.includes(legacy)) ?? action;
    };

    return {
      profile: pick('org.matrix.profile'),
      sessionsList: pick('org.matrix.devices_list'),
      sessionView: pick('org.matrix.device_view'),
      sessionEnd: pick('org.matrix.device_delete'),
      accountDeactivate: pick('org.matrix.account_deactivate'),
      crossSigningReset: pick('org.matrix.cross_signing_reset'),
    };
  }, [authMetadata]);

  return actions;
};
