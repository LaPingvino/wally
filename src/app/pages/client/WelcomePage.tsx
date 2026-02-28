import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import CinnySVG from '../../../../public/res/svg/cinny.svg';

const PATCHES: Array<{ name: string; desc: string }> = [
  { name: "emoji-font", desc: "Custom emoji font with Bah\u00e1'\u00ed symbols" },
  { name: "element-call", desc: "Voice and video calling via Element Call, with configurable ringtone and auto-join settings" },
  { name: "pronouns", desc: "Pronouns, timezone, and extended profile fields" },
  { name: "accessibility", desc: "ARIA roles, keyboard shortcuts, notification sounds, and screen-reader labels on all login forms" },
  { name: "issue-tracker", desc: "Schema-driven issue board stored in Matrix room state" },
  { name: "multi-account", desc: "Multiple Matrix accounts open simultaneously" },
  { name: "threads", desc: "Thread panel for viewing and replying to threads" },
  { name: "idb-retry", desc: "Automatic retry when IndexedDB fails on startup" },
  { name: "issue-widget", desc: "Issue tracker as an embeddable Matrix Widget API widget" },
  { name: "ux-fixes", desc: "Room sort options, inbox unread view, and navigation improvements" },
  { name: "widgets-support", desc: "Generic widget drawer for room widgets via the Matrix Widget API" },
  { name: "themes", desc: "Ash (dark neutral grey) and Sepia (warm parchment) themes" },
  { name: "per-msg-profiles", desc: "Per-message profiles (MSC4144): send messages as a persona, display sender personas inline" },
];

export function WelcomePage() {
  return (
    <Page>
      <Box
        grow="Yes"
        style={{ padding: config.space.S400, paddingBottom: config.space.S700 }}
        alignItems="Center"
        justifyContent="Center"
      >
        <PageHeroSection>
          <PageHero
            icon={<img width="70" height="70" src={CinnySVG} alt="Wally Logo" />}
            title="Welcome to Wally"
            subTitle={
              <span>
                A Cinny fork.{' '}
                <a
                  href="https://github.com/cinnyapp/cinny/releases"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  v4.11.1
                </a>
              </span>
            }
          >
            <Box direction="Column" gap="500" alignItems="Center">
              <Box justifyContent="Center">
                <Box grow="Yes" style={{ maxWidth: toRem(300) }} direction="Column" gap="300">
                  <Button
                    as="a"
                    href="https://codeberg.org/lapingvino/cinny"
                    target="_blank"
                    rel="noreferrer noopener"
                    before={<Icon size="200" src={Icons.Code} />}
                  >
                    <Text as="span" size="B400" truncate>
                      Source Code
                    </Text>
                  </Button>
                  <Button
                    as="a"
                    href="https://cinny.in/#sponsor"
                    target="_blank"
                    rel="noreferrer noopener"
                    fill="Soft"
                    before={<Icon size="200" src={Icons.Heart} />}
                  >
                    <Text as="span" size="B400" truncate>
                      Support Cinny
                    </Text>
                  </Button>
                </Box>
              </Box>
              <Box direction="Column" gap="200" style={{ maxWidth: toRem(480) }}>
                <Text size="L400">Active patches</Text>
                <Box
                  as="ul"
                  direction="Column"
                  gap="100"
                  style={{ margin: 0, paddingLeft: config.space.S400 }}
                >
                  {PATCHES.map(({ name, desc }) => (
                    <li key={name}>
                      <Text size="T300">
                        <a
                          href={`https://codeberg.org/lapingvino/cinny/src/branch/${name}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {name}
                        </a>
                        {' \u2014 '}
                        {desc}
                      </Text>
                    </li>
                  ))}
                </Box>
              </Box>
            </Box>
          </PageHero>
        </PageHeroSection>
      </Box>
    </Page>
  );
}
