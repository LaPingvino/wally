import {
  Box,
  Button,
  config,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
} from 'folds';
import {
  HttpApiEvent,
  HttpApiEventHandlerMap,
  MatrixClient,
  validateAuthMetadata,
} from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  clearCacheAndReload,
  clearLoginData,
  repairIDBAndReload,
  initClient,
  logoutClient,
  startClient,
} from '../../../client/initMatrix';
import {
  dumpFailureLog,
  exposeDiagnosticsOnWindow,
  installCryptoIdbErrorListener,
  logFailureEvent,
  requestPersistentStorage,
  runStartupIntegrityCheck,
  startHeartbeat,
} from '../../../client/diagnostics';
import { recordSessionStart } from '../../state/sessions';
import { SplashScreen } from '../../components/splash-screen';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { stopPropagation } from '../../utils/keyboard';
import { SyncStatus } from './SyncStatus';
import { VersionCheck } from './VersionCheck';
import { AuthMetadataProvider } from '../../hooks/useAuthMetadata';
import { getFallbackSession, removeSecondarySession } from '../../state/sessions';
import { AutoDiscovery } from './AutoDiscovery';
import { specVersions, SpecVersions as SpecVersionsData } from '../../cs-api';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import type { ServerConfigs } from '../../components/ServerConfigsLoader';

async function prefetchServerConfigs(mx: MatrixClient): Promise<ServerConfigs> {
  const [capsResult, mediaResult, authResult] = await Promise.allSettled([
    mx.getCapabilities(),
    mx.getMediaConfig(),
    mx.getAuthMetadata(),
  ]);
  const capabilities = capsResult.status === 'fulfilled' ? capsResult.value : undefined;
  const mediaConfig = mediaResult.status === 'fulfilled' ? mediaResult.value : undefined;
  const authMetadataRaw = authResult.status === 'fulfilled' ? authResult.value : undefined;
  let authMetadata;
  try {
    authMetadata = validateAuthMetadata(authMetadataRaw);
  } catch {
    // ignore — authMetadata stays undefined
  }
  return { capabilities, mediaConfig, authMetadata };
}

function ClientRootLoading() {
  return (
    <SplashScreen>
      <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
        <Spinner variant="Secondary" size="600" />
        <Text>Heating up</Text>
      </Box>
    </SplashScreen>
  );
}

function ClientRootOptions({ mx }: { mx?: MatrixClient }) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <IconButton
      style={{
        position: 'absolute',
        top: config.space.S100,
        right: config.space.S100,
      }}
      variant="Background"
      fill="None"
      onClick={handleToggle}
    >
      <Icon size="200" src={Icons.VerticalDots} />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {mx && (
                  <MenuItem onClick={() => clearCacheAndReload(mx)} size="300" radii="300">
                    <Text as="span" size="T300" truncate>
                      Clear Cache and Reload
                    </Text>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    if (mx) {
                      logoutClient(mx);
                      return;
                    }
                    // No client yet — check if this is a secondary account page so we
                    // don't accidentally wipe the main account's localStorage.
                    const slotStr = sessionStorage.getItem('cinny-account-slot');
                    const slot = slotStr !== null ? parseInt(slotStr, 10) : null;
                    const pathSlotMatch = window.location.pathname.match(/^\/account\/(\d+)/);
                    if (slot !== null || pathSlotMatch) {
                      if (slot !== null) {
                        removeSecondarySession(slot);
                        sessionStorage.removeItem('cinny-account-slot');
                      } else if (pathSlotMatch) {
                        removeSecondarySession(parseInt(pathSlotMatch[1], 10));
                      }
                      window.location.assign('/');
                    } else {
                      clearLoginData();
                    }
                  }}
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                >
                  <Text as="span" size="T300" truncate>
                    Logout
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </IconButton>
  );
}

const useLogoutListener = (mx?: MatrixClient) => {
  useEffect(() => {
    const handleLogout: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut] = async () => {
      mx?.stopClient();
      await mx?.clearStores();
      const slot = sessionStorage.getItem('cinny-account-slot');
      if (slot !== null) {
        // Secondary account session expired — remove it and return to main
        removeSecondarySession(parseInt(slot, 10));
        sessionStorage.removeItem('cinny-account-slot');
        window.location.assign('/');
      } else {
        window.localStorage.clear();
        window.location.reload();
      }
    };

    mx?.on(HttpApiEvent.SessionLoggedOut, handleLogout);
    return () => {
      mx?.removeListener(HttpApiEvent.SessionLoggedOut, handleLogout);
    };
  }, [mx]);
};

type ClientRootProps = {
  children: ReactNode;
};
export function ClientRoot({ children }: ClientRootProps) {
  const [loading, setLoading] = useState(true);
  const { baseUrl, userId } = getFallbackSession() ?? {};

  // Record session start time so mention search can limit how far back it looks.
  useEffect(() => { recordSessionStart(); }, []);

  // Request persistent storage — prevents ChromeOS from evicting IndexedDB.
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  // Fetch spec versions in parallel with initClient — children use empty fallback until resolved
  const [specVersionsData, setSpecVersionsData] = useState<SpecVersionsData>({ versions: [] });
  useEffect(() => {
    if (!baseUrl) return;
    specVersions(fetch, baseUrl)
      .then(setSpecVersionsData)
      .catch(() => {
        // keep empty fallback — features degrade gracefully, sync failure will surface if server is down
      });
  }, [baseUrl]);

  const [loadState, loadMatrix] = useAsyncCallback<MatrixClient, Error, []>(
    useCallback(async () => {
      const session = getFallbackSession();
      if (!session) {
        throw new Error('No session Found!');
      }
      // Pre-flight: detect Chromebook-style unclean shutdown (heartbeat gap)
      // and probe IDB. If IDB is wedged we trigger the existing repair flow
      // BEFORE matrix-js-sdk gets near it — the user never sees the
      // "Query failed: UnknownError" prompt in this case. The repair flow
      // tries the Cache-API checkpoint first, so crypto identity is
      // preserved when a checkpoint exists.
      //
      // Guard against repair loops via a sessionStorage marker — if the
      // last reload was caused by us, skip the auto-repair and let the
      // normal failure UI handle it.
      // Always expose wallyDiag() and dump the buffer to console — even
      // on the post-repair path we want this visible so the user can
      // inspect what happened in the previous session.
      exposeDiagnosticsOnWindow();
      void dumpFailureLog();

      const REPAIR_GUARD = 'cinny_startup_auto_repair_pending';
      const justRepaired = sessionStorage.getItem(REPAIR_GUARD) === '1';
      if (!justRepaired) {
        try {
          const result = await runStartupIntegrityCheck();
          if (!result.idbHealthy) {
            await logFailureEvent('startup_auto_repair', {
              uncleanShutdown: result.uncleanShutdown,
              heartbeatGapMs: result.heartbeatGapMs,
              storage: result.storage,
            });
            sessionStorage.setItem(REPAIR_GUARD, '1');
            // Repair will reload the page; this never returns.
            await repairIDBAndReload();
            // Defensive — if reload didn't happen, fall through.
          }
        } catch {
          // Diagnostics must never break startup.
        }
      } else {
        sessionStorage.removeItem(REPAIR_GUARD);
      }
      return initClient(session);
    }, [])
  );
  const mx = loadState.status === AsyncStatus.Success ? loadState.data : undefined;
  const [startState, startMatrix] = useAsyncCallback<void, Error, [MatrixClient]>(
    useCallback((m) => startClient(m), [])
  );

  // Start server config fetches as soon as mx is available — before /sync completes
  const [serverConfigs, setServerConfigs] = useState<ServerConfigs>({});
  useEffect(() => {
    if (!mx) return;
    prefetchServerConfigs(mx).then(setServerConfigs).catch(() => {
      // keep empty fallback
    });
  }, [mx]);

  useLogoutListener(mx);

  // Heartbeat lets us detect unclean shutdowns (Chromebook crashes etc.)
  // on the next page load. Idempotent — safe to call repeatedly.
  // Also request persistent storage so the browser doesn't evict our
  // checkpoint blobs under storage pressure.
  useEffect(() => {
    startHeartbeat();
    void requestPersistentStorage();
  }, []);

  // Catch IDB query failures fired from background promises (matrix-sdk-crypto's
  // internal queries are fire-and-forget so they don't reach loadMatrix's
  // try/catch). When one fires we log it and trigger the same auto-repair
  // path the pre-flight probe uses. Guard so we only fire once per session
  // and respect the same anti-loop sessionStorage marker.
  useEffect(() => {
    return installCryptoIdbErrorListener(({ message }) => {
      const REPAIR_GUARD = 'cinny_startup_auto_repair_pending';
      if (sessionStorage.getItem(REPAIR_GUARD) === '1') return;
      sessionStorage.setItem(REPAIR_GUARD, '1');
      void logFailureEvent('startup_auto_repair', {
        source: 'unhandledrejection',
        message: message.slice(0, 200),
      });
      void repairIDBAndReload();
    });
  }, []);

  useEffect(() => {
    if (loadState.status === AsyncStatus.Idle) {
      loadMatrix();
    }
  }, [loadState, loadMatrix]);

  useEffect(() => {
    if (mx && !mx.clientRunning) {
      startMatrix(mx);
    }
  }, [mx, startMatrix]);

  useSyncState(
    mx,
    useCallback((state) => {
      if (state === 'PREPARED' || state === 'SYNCING') {
        setLoading(false);
      }
    }, [])
  );

  return (
    <AutoDiscovery userId={userId!} baseUrl={baseUrl!}>
      <SpecVersionsProvider value={specVersionsData}>
        {mx && <SyncStatus mx={mx} />}
        <VersionCheck />
        {loading && <ClientRootOptions mx={mx} />}
        {(loadState.status === AsyncStatus.Error || startState.status === AsyncStatus.Error) && (
          <SplashScreen>
            <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
              <Dialog>
                <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                  {loadState.status === AsyncStatus.Error && (
                    <Text>{`Failed to load. ${loadState.error.message}`}</Text>
                  )}
                  {startState.status === AsyncStatus.Error && (
                    <Text>{`Failed to start. ${startState.error.message}`}</Text>
                  )}
                  <Button variant="Critical" onClick={mx ? () => startMatrix(mx) : loadMatrix}>
                    <Text as="span" size="B400">
                      Retry
                    </Text>
                  </Button>
                  {mx ? (
                    <Button
                      variant="Secondary"
                      fill="Soft"
                      onClick={() => clearCacheAndReload(mx)}
                    >
                      <Text as="span" size="B400">
                        Clear Cache and Reload
                      </Text>
                    </Button>
                  ) : (
                    <>
                      <Button variant="Secondary" fill="Soft" onClick={repairIDBAndReload}>
                        <Text as="span" size="B400">
                          Repair (keep session)
                        </Text>
                      </Button>
                      <Button variant="Critical" fill="Soft" onClick={clearLoginData}>
                        <Text as="span" size="B400">
                          Clear All Data (logout)
                        </Text>
                      </Button>
                    </>
                  )}
                </Box>
              </Dialog>
            </Box>
          </SplashScreen>
        )}
        {loading || !mx ? (
          <ClientRootLoading />
        ) : (
          <MatrixClientProvider value={mx}>
            <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
              <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                <AuthMetadataProvider value={serverConfigs.authMetadata}>
                  {children}
                </AuthMetadataProvider>
              </MediaConfigProvider>
            </CapabilitiesProvider>
          </MatrixClientProvider>
        )}
      </SpecVersionsProvider>
    </AutoDiscovery>
  );
}
