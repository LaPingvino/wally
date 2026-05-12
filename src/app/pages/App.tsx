import React from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { OverlayContainerProvider, PopOutContainerProvider, TooltipContainerProvider } from 'folds';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { ClientConfigLoader } from '../components/ClientConfigLoader';
import { ClientConfigProvider } from '../hooks/useClientConfig';
import { ConfigConfigError, ConfigConfigLoading } from './ConfigConfig';
import { FeatureCheck } from './FeatureCheck';
import { createRouter } from './Router';
import { ScreenSizeProvider, useScreenSize } from '../hooks/useScreenSize';
import { useCompositionEndTracking } from '../hooks/useComposingCheck';
import { setSessionOverride, getSessionForSlot } from '../state/sessions';

// Detect secondary account slot from URL (browser router) or sessionStorage (hash router)
const _slotMatch = window.location.pathname.match(/^\/account\/(\d+)(\/|$)/);
const _sessionSlot = (() => {
  const s = sessionStorage.getItem('wally-account-slot');
  return s !== null ? parseInt(s, 10) : null;
})();
const _accountSlot = _slotMatch ? parseInt(_slotMatch[1], 10) : _sessionSlot;
if (_accountSlot !== null) {
  const _sess = getSessionForSlot(_accountSlot);
  if (_sess) {
    setSessionOverride(_sess);
  } else {
    sessionStorage.removeItem('wally-account-slot');
  }
}
const _basename = _slotMatch ? `/account/${_accountSlot}/` : undefined;

const queryClient = new QueryClient();

function App() {
  const screenSize = useScreenSize();
  useCompositionEndTracking();

  const portalContainer = document.getElementById('portalContainer') ?? undefined;

  return (
    <TooltipContainerProvider value={portalContainer}>
      <PopOutContainerProvider value={portalContainer}>
        <OverlayContainerProvider value={portalContainer}>
          <ScreenSizeProvider value={screenSize}>
            <FeatureCheck>
              <ClientConfigLoader
                fallback={() => <ConfigConfigLoading />}
                error={(err, retry, ignore) => (
                  <ConfigConfigError error={err} retry={retry} ignore={ignore} />
                )}
              >
                {(clientConfig) => (
                  <ClientConfigProvider value={clientConfig}>
                    <QueryClientProvider client={queryClient}>
                      <JotaiProvider>
                        <RouterProvider router={createRouter(clientConfig, screenSize, _basename)} />
                      </JotaiProvider>
                      <ReactQueryDevtools initialIsOpen={false} />
                    </QueryClientProvider>
                  </ClientConfigProvider>
                )}
              </ClientConfigLoader>
            </FeatureCheck>
          </ScreenSizeProvider>
        </OverlayContainerProvider>
      </PopOutContainerProvider>
    </TooltipContainerProvider>
  );
}

export default App;
