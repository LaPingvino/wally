import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import CinnySVG from '../../../../public/res/svg/cinny.svg';

// Sync the entries here with PATCH_DEFS in cinny-web-git/push-to-codeberg.sh.
// Status reflects the latest audit: "full" applies cleanly to vanilla cinny
// (or to the listed dep chain), "partial" ships the cleanly-applicable subset
// of a coupled family, "branch" means no isolated patch is producible \u2014 fetch
// the per-family Codeberg branch instead.
const PATCHES: Array<{ name: string; desc: string; status: 'full' | 'partial' | 'branch' }> = [
  { name: 'emoji-font', desc: "Custom emoji font with Bah\u00e1'\u00ed symbols", status: 'full' },
  { name: 'pronouns', desc: 'Pronouns, timezone, and extended profile fields', status: 'full' },
  { name: 'accessibility', desc: 'ARIA roles, keyboard shortcuts, notification sounds, and screen-reader labels on all login forms', status: 'partial' },
  { name: 'issue-tracker', desc: 'Schema-driven issue board stored in Matrix room state', status: 'full' },
  { name: 'multi-account', desc: 'Multiple Matrix accounts open simultaneously', status: 'full' },
  { name: 'threads', desc: 'Thread panel for viewing and replying to threads', status: 'full' },
  { name: 'idb-retry', desc: 'Automatic retry when IndexedDB fails on startup', status: 'partial' },
  { name: 'issue-widget', desc: 'Issue tracker as an embeddable Matrix Widget API widget', status: 'full' },
  { name: 'ux-fixes', desc: 'Room sort options, inbox unread view, and navigation improvements', status: 'partial' },
  { name: 'navigate-unread', desc: 'Cross-bucket unread navigation, prev/next-unread shortcuts, sidebar-anchor handling for subspaces', status: 'partial' },
  { name: 'widgets-support', desc: 'Generic widget drawer for room widgets via the Matrix Widget API', status: 'partial' },
  { name: 'themes', desc: 'Ash (dark neutral grey) and Sepia (warm parchment) themes', status: 'full' },
  { name: 'per-msg-profiles', desc: 'Per-message profiles (MSC4144): send messages as a persona, display sender personas inline', status: 'full' },
  { name: 'markdown-parser', desc: 'markdown-it-based parser with spoilers, underline, GFM tables and autolinks', status: 'branch' },
];

const STATUS_BADGE: Record<'full' | 'partial' | 'branch', string> = {
  full: 'patch',
  partial: 'partial patch',
  branch: 'branch only',
};

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
                  {PATCHES.map(({ name, desc, status }) => (
                    <li key={name}>
                      <Text size="T300">
                        <a
                          href={`https://codeberg.org/lapingvino/cinny/src/branch/${name}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {name}
                        </a>
                        <span
                          aria-label={`status: ${STATUS_BADGE[status]}`}
                          style={{
                            marginLeft: '0.4em',
                            opacity: 0.6,
                            fontSize: '0.85em',
                          }}
                        >
                          ({STATUS_BADGE[status]})
                        </span>
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
