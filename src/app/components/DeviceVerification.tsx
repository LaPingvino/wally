import {
  ShowSasCallbacks,
  VerificationPhase,
  VerificationRequest,
  Verifier,
} from 'matrix-js-sdk/lib/crypto-api';
import React, { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { VerificationMethod } from 'matrix-js-sdk/lib/types';
import {
  Box,
  Button,
  config,
  Header,
  Icon,
  IconButton,
  Icons,
  Spinner,
  Text,
} from 'folds';
import { NativeDialog } from './NativeDialog';
import * as dialogCss from './NativeDialog.css';
import {
  useVerificationRequestPhase,
  useVerificationRequestReceived,
  useVerifierCancel,
  useVerifierShowSas,
} from '../hooks/useVerificationRequest';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { ContainerColor } from '../styles/ContainerColor.css';

const DialogHeaderStyles: CSSProperties = {
  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
  borderBottomWidth: config.borderWidth.B300,
};

type WaitingMessageProps = {
  message: string;
};
function WaitingMessage({ message }: WaitingMessageProps) {
  return (
    <Box alignItems="Center" gap="200">
      <Spinner variant="Secondary" size="200" />
      <Text size="T300">{message}</Text>
    </Box>
  );
}

type VerificationUnexpectedProps = { message: string; onClose: () => void };
function VerificationUnexpected({ message, onClose }: VerificationUnexpectedProps) {
  return (
    <Box direction="Column" gap="400">
      <Text>{message}</Text>
      <Button variant="Secondary" fill="Soft" onClick={onClose}>
        <Text size="B400">Close</Text>
      </Button>
    </Box>
  );
}

function VerificationWaitAccept() {
  return (
    <Box direction="Column" gap="400">
      <Text>Please accept the request from other device.</Text>
      <WaitingMessage message="Waiting for request to be accepted..." />
    </Box>
  );
}

type VerificationAcceptProps = {
  onAccept: () => Promise<void>;
};
function VerificationAccept({ onAccept }: VerificationAcceptProps) {
  const [acceptState, accept] = useAsyncCallback(onAccept);

  const accepting = acceptState.status === AsyncStatus.Loading;
  return (
    <Box direction="Column" gap="400">
      <Text>Click accept to start the verification process.</Text>
      <Button
        variant="Primary"
        fill="Solid"
        onClick={accept}
        before={accepting && <Spinner size="100" variant="Primary" fill="Solid" />}
        disabled={accepting}
      >
        <Text size="B400">Accept</Text>
      </Button>
    </Box>
  );
}

function VerificationWaitStart() {
  return (
    <Box direction="Column" gap="400">
      <Text>Verification request has been accepted.</Text>
      <WaitingMessage message="Waiting for the response from other device..." />
    </Box>
  );
}

type VerificationStartProps = {
  onStart: () => Promise<void>;
};
function AutoVerificationStart({ onStart }: VerificationStartProps) {
  useEffect(() => {
    onStart();
  }, [onStart]);

  return (
    <Box direction="Column" gap="400">
      <WaitingMessage message="Starting verification using emoji comparison..." />
    </Box>
  );
}

function CompareEmoji({
  sasData,
  onConfirmStart,
}: {
  sasData: ShowSasCallbacks;
  onConfirmStart: () => void;
}) {
  const [confirmState, confirm] = useAsyncCallback(
    useCallback(() => {
      // Mark confirmed BEFORE the async confirm so the dialog's close/backdrop
      // handler can no longer cancel a match that's already affirmed.
      onConfirmStart();
      return sasData.confirm();
    }, [sasData, onConfirmStart])
  );

  const confirming =
    confirmState.status === AsyncStatus.Loading || confirmState.status === AsyncStatus.Success;

  // Once "They Match" is pressed, REMOVE the mismatch control entirely (not merely
  // disable it). m.mismatched_sas is only ever produced by an explicit mismatch()
  // call; leaving that button mounted during the completion window let a stray tap
  // turn an affirmed match into a cancel — the "They match cancels" bug.
  if (confirming) {
    return (
      <Box direction="Column" gap="400">
        <Text>You confirmed the emoji match. Finishing verification…</Text>
        <WaitingMessage message="Waiting for the other device to confirm..." />
      </Box>
    );
  }

  return (
    <Box direction="Column" gap="400">
      <Text>Confirm the emoji below are displayed on both devices, in the same order:</Text>
      <Box
        className={ContainerColor({ variant: 'SurfaceVariant' })}
        style={{
          borderRadius: config.radii.R400,
          padding: config.space.S500,
        }}
        gap="700"
        wrap="Wrap"
        justifyContent="Center"
      >
        {sasData.sas.emoji?.map(([emoji, name], index) => (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={`${emoji}${name}${index}`}
            direction="Column"
            gap="100"
            justifyContent="Center"
            alignItems="Center"
          >
            <Text size="H1">{emoji}</Text>
            <Text size="T200">{name}</Text>
          </Box>
        ))}
      </Box>
      <Box direction="Column" gap="200">
        {/* "They Match" is the prominent Solid primary; "Do not Match" is a distinct
            Critical/None button so it can't be hit by accident as a look-alike. */}
        <Button variant="Primary" fill="Solid" onClick={confirm}>
          <Text size="B400">They Match</Text>
        </Button>
        <Button
          variant="Critical"
          fill="None"
          onClick={() => {
            // eslint-disable-next-line no-console
            console.warn('[wally][verify] "Do not Match" pressed — sending m.mismatched_sas');
            sasData.mismatch();
          }}
        >
          <Text size="B400">Do not Match</Text>
        </Button>
      </Box>
    </Box>
  );
}

type SasVerificationProps = {
  verifier: Verifier;
  onCancel: () => void;
  onConfirmStart: () => void;
};
function SasVerification({ verifier, onCancel, onConfirmStart }: SasVerificationProps) {
  const [sasData, setSasData] = useState<ShowSasCallbacks>();

  useVerifierShowSas(verifier, setSasData);
  useVerifierCancel(verifier, onCancel);

  useEffect(() => {
    verifier.verify();
  }, [verifier]);

  useEffect(() => {
    if (sasData) {
      // eslint-disable-next-line no-console
      console.warn(
        '[wally][verify] SAS emoji:',
        (sasData.sas.emoji ?? []).map(([, name]) => name).join(' ')
      );
    }
  }, [sasData]);

  if (sasData) {
    return <CompareEmoji sasData={sasData} onConfirmStart={onConfirmStart} />;
  }

  return (
    <Box direction="Column" gap="400">
      <WaitingMessage message="Starting verification using emoji comparison..." />
    </Box>
  );
}

type VerificationDoneProps = {
  onExit: () => void;
};
function VerificationDone({ onExit }: VerificationDoneProps) {
  return (
    <Box direction="Column" gap="400">
      <div>
        <Text>Your device is verified.</Text>
      </div>
      <Button variant="Primary" fill="Solid" onClick={onExit}>
        <Text size="B400">Okay</Text>
      </Button>
    </Box>
  );
}

type VerificationCanceledProps = {
  onClose: () => void;
};
function VerificationCanceled({ onClose }: VerificationCanceledProps) {
  return (
    <Box direction="Column" gap="400">
      <Text>Verification has been canceled.</Text>
      <Button variant="Secondary" fill="Soft" onClick={onClose}>
        <Text size="B400">Close</Text>
      </Button>
    </Box>
  );
}

type DeviceVerificationProps = {
  request: VerificationRequest;
  onExit: () => void;
};
export function DeviceVerification({ request, onExit }: DeviceVerificationProps) {
  const phase = useVerificationRequestPhase(request);
  // Set the moment "They Match" is pressed. After that, closing the dialog must
  // NOT call request.cancel() — the verification is completing and a cancel here
  // would abort an affirmed match.
  const confirmedRef = useRef(false);

  const handleCancel = useCallback(() => {
    if (confirmedRef.current) {
      onExit();
      return;
    }
    if (request.phase !== VerificationPhase.Done && request.phase !== VerificationPhase.Cancelled) {
      request.cancel();
    }
    onExit();
  }, [request, onExit]);

  const handleConfirmStart = useCallback(() => {
    confirmedRef.current = true;
  }, []);

  const handleAccept = useCallback(() => request.accept(), [request]);
  const handleStart = useCallback(async () => {
    await request.startVerification(VerificationMethod.Sas);
  }, [request]);

  return (
    <NativeDialog open onClose={handleCancel} className={dialogCss.NativeDialog}>
            <Header style={DialogHeaderStyles} variant="Surface" size="500">
              <Box grow="Yes">
                <Text size="H4">Device Verification</Text>
              </Box>
              <IconButton size="300" radii="300" onClick={handleCancel}>
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              {phase === VerificationPhase.Requested &&
                (request.initiatedByMe ? (
                  <VerificationWaitAccept />
                ) : (
                  <VerificationAccept onAccept={handleAccept} />
                ))}
              {phase === VerificationPhase.Ready &&
                (request.initiatedByMe ? (
                  <AutoVerificationStart onStart={handleStart} />
                ) : (
                  <VerificationWaitStart />
                ))}
              {phase === VerificationPhase.Started &&
                (request.verifier ? (
                  <SasVerification
                    verifier={request.verifier}
                    onCancel={handleCancel}
                    onConfirmStart={handleConfirmStart}
                  />
                ) : (
                  <VerificationUnexpected
                    message="Unexpected Error! Verification is started but verifier is missing."
                    onClose={handleCancel}
                  />
                ))}
              {phase === VerificationPhase.Done && <VerificationDone onExit={onExit} />}
              {phase === VerificationPhase.Cancelled && (
                <VerificationCanceled onClose={handleCancel} />
              )}
            </Box>
    </NativeDialog>
  );
}

export function ReceiveSelfDeviceVerification() {
  const [request, setRequest] = useState<VerificationRequest>();

  useVerificationRequestReceived(setRequest);

  const handleExit = useCallback(() => {
    setRequest(undefined);
  }, []);

  if (!request) return null;

  if (!request.isSelfVerification) {
    return null;
  }

  return <DeviceVerification request={request} onExit={handleExit} />;
}
