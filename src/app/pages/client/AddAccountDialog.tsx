import React, { FormEventHandler, useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  Spinner,
  Text,
  color,
  config,
} from 'folds';

import { addSecondarySession } from '../../state/sessions';
import { autoDiscovery } from '../../cs-api';
import { login, LoginError } from '../auth/login/loginUtil';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { PasswordInput } from '../../components/password-input';
import { useClientConfig, clientDefaultServer } from '../../hooks/useClientConfig';
import { NativeDialog } from '../../components/NativeDialog';
import * as dialogCss from '../../components/NativeDialog.css';

type AddAccountDialogProps = {
  onClose: () => void;
};

export function AddAccountDialog({ onClose }: AddAccountDialogProps) {
  const clientConfig = useClientConfig();
  const defaultServer = clientDefaultServer(clientConfig);
  const { hashRouter } = clientConfig;
  const [server, setServer] = useState(defaultServer);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [loginState, startLogin] = useAsyncCallback(
    useCallback(
      async (homeserver: string, username: string, password: string) => {
        setLoginError(null);
        const [discoveryErr, discoveryInfo] = await autoDiscovery(fetch, homeserver);
        if (discoveryErr || !discoveryInfo) {
          throw new Error('Failed to connect to homeserver');
        }
        const baseUrl = discoveryInfo['m.homeserver'].base_url;
        const result = await login(baseUrl, {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: username },
          password,
          initial_device_display_name: 'Wally',
        });
        return { baseUrl: result.baseUrl, response: result.response };
      },
      []
    )
  );

  useEffect(() => {
    if (loginState.status === AsyncStatus.Success) {
      const { response, baseUrl } = loginState.data;
      const session = {
        baseUrl,
        userId: response.user_id,
        deviceId: response.device_id,
        accessToken: response.access_token,
      };
      const slot = addSecondarySession(session);
      sessionStorage.setItem('wally-account-slot', String(slot));
      if (hashRouter?.enabled) {
        window.location.reload();
      } else {
        window.location.assign(`/account/${slot}/`);
      }
    }
  }, [loginState]);

  useEffect(() => {
    if (loginState.status === AsyncStatus.Error) {
      const err = loginState.error as Error & { errcode?: string };
      if (err.errcode === LoginError.Forbidden) {
        setLoginError('Invalid username or password.');
      } else if (err.message === 'Failed to connect to homeserver') {
        setLoginError('Failed to connect to homeserver.');
      } else {
        setLoginError(`Login failed: ${err.message ?? 'Unknown error'}`);
      }
    }
  }, [loginState]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const form = evt.target as HTMLFormElement & {
      homeserverInput: HTMLInputElement;
      usernameInput: HTMLInputElement;
      passwordInput: HTMLInputElement;
    };
    const homeserver = form.homeserverInput.value.trim() || server;
    const username = form.usernameInput.value.trim();
    const password = form.passwordInput.value;
    if (!username) {
      form.usernameInput.focus();
      return;
    }
    if (!password) {
      form.passwordInput.focus();
      return;
    }
    startLogin(homeserver, username, password);
  };

  const loading =
    loginState.status === AsyncStatus.Loading || loginState.status === AsyncStatus.Success;

  return (
    <NativeDialog open onClose={onClose} className={dialogCss.NativeDialog}>
        <Box
          as="form"
          onSubmit={handleSubmit}
          direction="Column"
          gap="400"
          style={{ padding: config.space.S400 }}
        >
          <Box direction="Row" alignItems="Center" justifyContent="SpaceBetween">
            <Text size="H4" as="h2">Add Account</Text>
            <IconButton
              onClick={onClose}
              variant="Background"
              fill="None"
              size="300"
              radii="300"
              aria-label="Close"
            >
              <Icon size="200" src={Icons.Cross} />
            </IconButton>
          </Box>

          <Box direction="Column" gap="100">
            <Text as="label" htmlFor="add-account-server" size="L400" priority="300">
              Homeserver
            </Text>
            <Input
              id="add-account-server"
              name="homeserverInput"
              variant="Background"
              size="500"
              outlined
              defaultValue={server}
              onChange={(e) => setServer((e.target as HTMLInputElement).value.trim() || defaultServer)}
            />
          </Box>

          <Box direction="Column" gap="100">
            <Text as="label" htmlFor="add-account-username" size="L400" priority="300">
              Username or Matrix ID
            </Text>
            <Input
              id="add-account-username"
              name="usernameInput"
              variant="Background"
              size="500"
              outlined
              required
              autoComplete="username"
            />
          </Box>

          <Box direction="Column" gap="100">
            <Text as="label" htmlFor="add-account-password" size="L400" priority="300">
              Password
            </Text>
            <PasswordInput
              id="add-account-password"
              name="passwordInput"
              variant="Background"
              size="500"
              outlined
              required
              autoComplete="current-password"
            />
            {loginError && (
              <Text style={{ color: color.Critical.Main }} size="T300">
                {loginError}
              </Text>
            )}
          </Box>

          <Button type="submit" variant="Primary" size="500" disabled={loading}>
            <Text as="span" size="B500">
              Add Account
            </Text>
          </Button>

          {loading && (
            <Box
              style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}
            >
              <Spinner variant="Secondary" size="600" />
            </Box>
          )}
        </Box>
    </NativeDialog>
  );
}
