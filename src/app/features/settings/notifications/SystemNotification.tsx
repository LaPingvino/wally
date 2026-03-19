import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Text, Switch, color, Spinner, Icon, IconButton, Icons, config } from 'folds';

import { IPusherRequest } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';

function EmailNotification() {
  const mx = useMatrixClient();
  const [result, refreshResult] = useEmailNotifications();

  const [setState, setEnable] = useAsyncCallback(
    useCallback(
      async (email: string, enable: boolean) => {
        if (enable) {
          await mx.setPusher({
            kind: 'email',
            app_id: 'm.email',
            pushkey: email,
            app_display_name: 'Email Notifications',
            device_display_name: email,
            lang: 'en',
            data: {
              brand: 'Cinny',
            },
            append: true,
          });
          return;
        }
        await mx.setPusher({
          pushkey: email,
          app_id: 'm.email',
          kind: null,
        } as unknown as IPusherRequest);
      },
      [mx]
    )
  );

  const handleChange = (value: boolean) => {
    if (result && result.email) {
      setEnable(result.email, value).then(() => {
        refreshResult();
      });
    }
  };

  return (
    <SettingTile
      title="Email Notification"
      description={
        <>
          {result && !result.email && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Your account does not have any email attached.
            </Text>
          )}
          {result && result.email && <>Send notification to your email. {`("${result.email}")`}</>}
          {result === null && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Unexpected Error!
            </Text>
          )}
          {result === undefined && 'Send notification to your email.'}
        </>
      }
      after={
        <>
          {setState.status !== AsyncStatus.Loading &&
            typeof result === 'object' &&
            result?.email && <Switch value={result.enabled} onChange={handleChange} />}
          {(setState.status === AsyncStatus.Loading || result === undefined) && (
            <Spinner variant="Secondary" />
          )}
        </>
      }
    />
  );
}

type CallRingScope = 'dm' | 'nonVoice' | 'all';

const CALL_RING_SCOPE_LABELS: Record<CallRingScope, string> = {
  dm: 'DMs only',
  nonVoice: 'All except voice rooms',
  all: 'All rooms',
};


function RingtoneUrlInput() {
  const [callRingtoneUrl, setCallRingtoneUrl] = useSetting(settingsAtom, 'callRingtoneUrl');
  const [draft, setDraft] = useState(callRingtoneUrl ?? '');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Sync when set externally (e.g., "Set as ringtone" from a chat audio message)
  useEffect(() => {
    setDraft(callRingtoneUrl ?? '');
  }, [callRingtoneUrl]);

  const commit = () => {
    const trimmed = draft.trim();
    setCallRingtoneUrl(trimmed || null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setDraft(dataUrl);
      setCallRingtoneUrl(dataUrl);
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be re-selected if needed
    e.target.value = '';
  };

  return (
    <Box direction="Row" gap="200" alignItems="Center" grow="Yes">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileChange}
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      <input
        type="url"
        value={draft.startsWith('data:') ? '(uploaded file)' : draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder="https://... or mxc://..."
        aria-label="Custom ringtone URL"
        readOnly={draft.startsWith('data:')}
        style={{
          flexGrow: 1,
          minWidth: 0,
          background: 'transparent',
          border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
          borderRadius: config.radii.R300,
          padding: `${config.space.S100} ${config.space.S200}`,
          color: 'inherit',
          font: 'inherit',
          outline: 'none',
        }}
      />
      <IconButton
        size="300"
        radii="Pill"
        variant="SurfaceVariant"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Upload audio file as ringtone"
        title="Upload audio file"
      >
        <Icon src={Icons.ArrowTop} size="50" />
      </IconButton>
      {callRingtoneUrl && (
        <IconButton
          size="300"
          radii="Pill"
          variant="SurfaceVariant"
          onClick={() => { setDraft(''); setCallRingtoneUrl(null); }}
          aria-label="Reset to built-in ringtone"
        >
          <Icon src={Icons.Cross} size="50" />
        </IconButton>
      )}
    </Box>
  );
}

const BATCH_DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Immediately' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
];

const selectStyle: React.CSSProperties = {
  padding: `2px ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: `1px solid ${color.Surface.ContainerLine}`,
  background: color.Surface.Container,
  color: 'inherit',
  font: 'inherit',
  fontSize: '0.85em',
};

function SelectBatchDelay() {
  const [batchDelay, setBatchDelay] = useSetting(settingsAtom, 'inboxNotifBatchDelay');
  return (
    <select
      style={selectStyle}
      value={batchDelay ?? 60}
      onChange={(e) => setBatchDelay(Number(e.target.value))}
      aria-label="Notification batch interval"
    >
      {BATCH_DELAY_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function SelectCallRingScope() {
  const [callRingScope, setCallRingScope] = useSetting(settingsAtom, 'callRingScope');
  return (
    <select
      style={selectStyle}
      value={callRingScope ?? 'nonVoice'}
      onChange={(e) => setCallRingScope(e.target.value as CallRingScope)}
      aria-label="Incoming call ring scope"
    >
      {(Object.entries(CALL_RING_SCOPE_LABELS) as [CallRingScope, string][]).map(([val, label]) => (
        <option key={val} value={val}>{label}</option>
      ))}
    </select>
  );
}

export function SystemNotification() {
  const notifPermission = usePermissionState('notifications', getNotificationState());
  const [showNotifications, setShowNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [isNotificationSounds, setIsNotificationSounds] = useSetting(
    settingsAtom,
    'isNotificationSounds'
  );
  const [inRoomActivitySound, setInRoomActivitySound] = useSetting(settingsAtom, 'inRoomActivitySound');
  const [callAutoJoin, setCallAutoJoin] = useSetting(settingsAtom, 'callAutoJoin');
  const [inboxUnreadNotifications, setInboxUnreadNotifications] = useSetting(settingsAtom, 'inboxUnreadNotifications');

  const requestNotificationPermission = () => {
    window.Notification.requestPermission();
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">System</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Desktop Notifications"
          description={
            notifPermission === 'denied' ? (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                {'Notification' in window
                  ? 'Notification permission is blocked. Please allow notification permission from browser address bar.'
                  : 'Notifications are not supported by the system.'}
              </Text>
            ) : (
              <span>Show desktop notifications when message arrive.</span>
            )
          }
          after={
            notifPermission === 'prompt' ? (
              <Button size="300" radii="300" onClick={requestNotificationPermission}>
                <Text size="B300">Enable</Text>
              </Button>
            ) : (
              <Switch
                disabled={notifPermission !== 'granted'}
                value={showNotifications}
                onChange={setShowNotifications}
              />
            )
          }
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Notification Sound"
          description="Play mention, other-room, and reaction sounds when messages arrive."
          after={<Switch value={isNotificationSounds} onChange={setIsNotificationSounds} />}
        />
        <SettingTile
          title="In-Room Activity Sounds"
          description="Play a soft beep for messages in the current room, and a click when someone starts typing."
          after={<Switch value={inRoomActivitySound} onChange={setInRoomActivitySound} />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Custom Ringtone"
          description="Paste an audio URL (https:// or mxc://), upload a file, or click 'Set as ringtone' on any audio message in chat. Leave empty to use the built-in ring."
          after={<RingtoneUrlInput />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Incoming Call Ringtone"
          description="Choose which rooms trigger an incoming call ring."
          after={<SelectCallRingScope />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Auto-Join Calls"
          description="Skip the call lobby and join immediately when opening a call."
          after={<Switch value={callAutoJoin} onChange={setCallAutoJoin} />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Unread Inbox Notifications"
          description={
            !showNotifications && notifPermission === 'granted'
              ? 'Enable "Desktop Notifications" above to use this feature.'
              : 'Send a desktop notification when rooms with unread messages appear in your Unread inbox. Unlike the notification above, this fires for all unread rooms, not just mentions.'
          }
          after={
            <Switch
              disabled={notifPermission === 'denied' || !showNotifications}
              value={inboxUnreadNotifications && showNotifications}
              onChange={(v) => {
                if (v && notifPermission === 'prompt') requestNotificationPermission();
                setInboxUnreadNotifications(v);
              }}
            />
          }
        />
        {inboxUnreadNotifications && showNotifications && (
          <SettingTile
            title="Notification Batch Interval"
            description="Minimum time between unread notifications. 'Immediately' fires within ~1 second."
            after={<SelectBatchDelay />}
          />
        )}
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
