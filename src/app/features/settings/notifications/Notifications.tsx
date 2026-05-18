import React from 'react';
import { Box, Switch, Text, IconButton, Icon, Icons, Scroll } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SystemNotification } from './SystemNotification';
import { AllMessagesNotifications } from './AllMessages';
import { SpecialMessagesNotifications } from './SpecialMessages';
import { KeywordMessagesNotifications } from './KeywordMessages';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

type NotificationsProps = {
  requestClose: () => void;
};
function NoticesSection() {
  const [noticeInboxOnlyDefault, setNoticeInboxOnlyDefault] = useSetting(
    settingsAtom,
    'noticeInboxOnlyDefault'
  );
  const [noticesMarkUnread, setNoticesMarkUnread] = useSetting(
    settingsAtom,
    'noticesMarkUnread'
  );
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Notices</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Default: notices in inbox only"
          description="When on, m.notice messages (heisenbridge logs, wallops, bot status, the issue tracker) are hidden from room timelines and visible only via the Notices inbox tab. Each room can override this from its context menu."
          after={
            <Switch
              variant="Primary"
              value={noticeInboxOnlyDefault}
              onChange={setNoticeInboxOnlyDefault}
            />
          }
        />
        <SettingTile
          title="Notices mark rooms as unread"
          description="When on, m.notice messages bump unread counts and the room sidebar dot. When off (default), chatty bots and bridge logs stay quiet — they're visible in the Notices inbox but don't draw your eye."
          after={
            <Switch
              variant="Primary"
              value={noticesMarkUnread}
              onChange={setNoticesMarkUnread}
            />
          }
        />
      </SequenceCard>
    </Box>
  );
}

export function Notifications({ requestClose }: NotificationsProps) {
  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Notifications
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <SystemNotification />
              <AllMessagesNotifications />
              <SpecialMessagesNotifications />
              <KeywordMessagesNotifications />
              <NoticesSection />
              <Box direction="Column" gap="100">
                <Text size="L400">Block Messages</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    description={'Blocking lives under "Moderation > Block Users".'}
                  />
                </SequenceCard>
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
