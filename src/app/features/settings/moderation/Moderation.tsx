import React from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Switch } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { InviteBlocking } from './InviteBlocking';
import { IgnoredUserList } from './IgnoredUserList';

function MessageDisplay() {
  const [hideBlockedUserReactions, setHideBlockedUserReactions] = useSetting(
    settingsAtom,
    'hideBlockedUserReactions'
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Message display</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Hide reactions from blocked users"
          description="Reactions from users on your blocked list won't be shown."
          after={
            <Switch
              variant="Primary"
              value={hideBlockedUserReactions}
              onChange={setHideBlockedUserReactions}
            />
          }
        />
      </SequenceCard>
    </Box>
  );
}

type ModerationProps = {
  requestClose: () => void;
};
export function Moderation({ requestClose }: ModerationProps) {
  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Moderation & Safety
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface" aria-label="Close">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <InviteBlocking />
              <IgnoredUserList />
              <MessageDisplay />
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
