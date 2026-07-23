import React, { FormEventHandler, useCallback, useState } from 'react';
import { Box, Button, Header, Input, Scroll, Spinner, Text, color } from 'folds';
import { useParams, useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import * as css from './auth/styles.css';
import * as PatternsCss from '../styles/Patterns.css';
import WallySVG from '../../../public/res/svg/wally.svg';
import { AuthFooter } from './auth/AuthFooter';
import { GuestCallView } from '../features/call/GuestCallView';

type JoinResponse = {
  session_id: string;
  /** Legacy Element Call URL — no longer used; guests now join LiveKit directly. */
  ec_url?: string;
  livekit_url: string;
  token: string;
};

type JoinState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; livekitUrl: string; token: string; displayName: string };

export function GuestJoin() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const endpoint = searchParams.get('endpoint') ?? '';

  const [displayName, setDisplayName] = useState('');
  const [joinState, setJoinState] = useState<JoinState>({ status: 'idle' });

  const decodedRoomId = roomId ? decodeURIComponent(roomId) : '';

  const handleJoin: FormEventHandler<HTMLFormElement> = useCallback(
    async (evt) => {
      evt.preventDefault();
      if (!endpoint) {
        setJoinState({ status: 'error', message: 'No endpoint specified in the URL.' });
        return;
      }
      if (!decodedRoomId) {
        setJoinState({ status: 'error', message: 'No room ID specified.' });
        return;
      }
      const name = displayName.trim();
      if (!name) {
        setJoinState({ status: 'error', message: 'Please enter a display name.' });
        return;
      }

      setJoinState({ status: 'loading' });

      try {
        const joinUrl = `${endpoint.replace(/\/$/, '')}/join`;
        const res = await fetch(joinUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: decodedRoomId,
            display_name: name,
          }),
        });

        if (!res.ok) {
          let errMsg = `Server returned ${res.status}`;
          try {
            const errBody = await res.json();
            if (errBody.error) errMsg = errBody.error;
          } catch {
            // ignore parse errors
          }
          setJoinState({ status: 'error', message: errMsg });
          return;
        }

        const data: JoinResponse = await res.json();
        if (!data.livekit_url || !data.token) {
          setJoinState({ status: 'error', message: 'No call credentials returned from server.' });
          return;
        }

        // Join LiveKit directly in a native guest view (no Element Call).
        setJoinState({
          status: 'success',
          livekitUrl: data.livekit_url,
          token: data.token,
          displayName: name,
        });
      } catch (err) {
        setJoinState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to join call.',
        });
      }
    },
    [endpoint, decodedRoomId, displayName]
  );

  if (joinState.status === 'success') {
    return (
      <Box style={{ height: '100%', width: '100%' }}>
        <GuestCallView
          livekitUrl={joinState.livekitUrl}
          token={joinState.token}
          displayName={joinState.displayName}
          onLeave={() => setJoinState({ status: 'idle' })}
        />
      </Box>
    );
  }

  return (
    <Scroll variant="Background" visibility="Hover" size="300" hideTrack>
      <Box
        className={classNames(css.AuthLayout, PatternsCss.BackgroundDotPattern)}
        direction="Column"
        alignItems="Center"
        justifyContent="SpaceBetween"
        gap="400"
      >
        <Box direction="Column" className={css.AuthCard}>
          <Header className={css.AuthHeader} size="600" variant="Surface">
            <Box grow="Yes" direction="Row" gap="300" alignItems="Center">
              <img className={css.AuthLogo} src={WallySVG} alt="Wally Logo" />
              <Text size="H3" as="h1">
                Wally
              </Text>
            </Box>
          </Header>
          <Box className={css.AuthCardContent} direction="Column">
            <Box direction="Column" gap="400">
              <Text size="H4" as="h2">
                Join Call as Guest
              </Text>
              <Box direction="Column" gap="100">
                <Text size="T300" priority="300">
                  Room
                </Text>
                <Text size="B400" style={{ wordBreak: 'break-all' }}>
                  {decodedRoomId || '(unknown)'}
                </Text>
              </Box>

              {!endpoint && (
                <Text size="T300" style={{ color: color.Critical.Main }}>
                  No endpoint specified in the URL. This link may be incomplete.
                </Text>
              )}

              <form onSubmit={handleJoin}>
                <Box direction="Column" gap="400">
                  <Box direction="Column" gap="100">
                    <Text as="label" size="L400" priority="300" htmlFor="guest-display-name">
                      Display Name
                    </Text>
                    <Input
                      id="guest-display-name"
                      name="displayName"
                      size="400"
                      variant="Background"
                      defaultValue=""
                      required
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setDisplayName(e.target.value)
                      }
                      autoFocus
                      disabled={joinState.status === 'loading'}
                    />
                  </Box>

                  {joinState.status === 'error' && (
                    <Text size="T300" style={{ color: color.Critical.Main }}>
                      {joinState.message}
                    </Text>
                  )}

                  <Button
                    type="submit"
                    variant="Primary"
                    size="400"
                    disabled={!endpoint || joinState.status === 'loading'}
                  >
                    {joinState.status === 'loading' ? (
                      <Spinner size="100" variant="Secondary" fill="Soft" />
                    ) : (
                      <Text size="B400" as="span">
                        Join Call
                      </Text>
                    )}
                  </Button>
                </Box>
              </form>
            </Box>
          </Box>
        </Box>
        <AuthFooter />
      </Box>
    </Scroll>
  );
}
