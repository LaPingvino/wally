import React, { useEffect, useState } from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import WallySVG from '../../../../public/res/svg/wally.svg';
import { APP_VERSION } from '../../version';
import { copyToClipboard } from '../../utils/dom';
import { announce } from '../../utils/announce';

// Voluntary support, mirroring the footer of esperanto-kurso.net: the thing is
// free and stays free, and the ask is folded away behind a disclosure rather
// than sitting in your face.
const SUPPORT_LINKS: Array<{ method: string; href: string; label: string }> = [
  { method: 'bunq', href: 'https://bunq.me/lapingvino', label: 'bunq.me/lapingvino' },
  {
    method: 'PayPal',
    href: 'https://www.paypal.com/paypalme/lapingvino',
    label: 'paypal.me/lapingvino',
  },
];
const SUPPORT_BCH = 'bitcoincash:qrrqxuwdh4j92vytr89n95xhvvcraugju53j7glf20';
const SUPPORT_BCH_SHORT = 'qrrqxuwd…ju53j7glf20';

function SupportSection() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Box direction="Column" gap="200">
      <Button
        onClick={() => setOpen(!open)}
        fill="Soft"
        aria-expanded={open}
        aria-controls="support-options"
        before={<Icon size="200" src={Icons.Heart} />}
      >
        <Text as="span" size="B400" truncate>
          Support Wally
        </Text>
      </Button>
      {open && (
        <Box
          id="support-options"
          direction="Column"
          gap="200"
          role="group"
          aria-label="Support Wally"
        >
          <Text size="T200" priority="400">
            Wally is free and will stay free for everyone. If you&apos;d like to help with the
            running costs anyway, that&apos;s very welcome — thank you!
          </Text>
          {SUPPORT_LINKS.map(({ method, href, label }) => (
            <Text key={method} size="T200">
              {`${method}: `}
              <a href={href} target="_blank" rel="noreferrer noopener">
                {label}
              </a>
            </Text>
          ))}
          <Box gap="200" alignItems="Center" wrap="Wrap">
            <Text size="T200">
              {'Bitcoin Cash: '}
              <a href={SUPPORT_BCH}>
                <code>{SUPPORT_BCH_SHORT}</code>
              </a>
            </Text>
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              onClick={() => {
                copyToClipboard(SUPPORT_BCH);
                setCopied(true);
                // The button's own label changing is not reliably re-read by a
                // screen reader while focus stays on it — route it through the
                // app's live region like every other announcement.
                announce('Bitcoin Cash address copied to clipboard');
              }}
            >
              <Text as="span" size="B300">
                {copied ? 'Copied' : 'Copy address'}
              </Text>
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Sync the entries here with PATCH_DEFS in wally-web-git/push-to-github.sh.
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
  { name: 'widgets-support', desc: 'Generic widget drawer for room widgets via the Matrix Widget API', status: 'branch' },
  { name: 'themes', desc: 'Ash (dark neutral grey) and Sepia (warm parchment) themes', status: 'full' },
  { name: 'per-msg-profiles', desc: 'Per-message profiles (MSC4144): send messages as a persona, display sender personas inline', status: 'branch' },
  { name: 'markdown-parser', desc: 'markdown-it-based parser with spoilers, underline, GFM tables and autolinks', status: 'full' },
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
            icon={<img width="70" height="70" src={WallySVG} alt="Wally Logo" />}
            title="Welcome to Wally"
            subTitle={
              <span>
                A stubborn Matrix client.{' '}
                <a
                  href="https://github.com/LaPingvino/wally/releases"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  v{APP_VERSION}
                </a>
              </span>
            }
          >
            <Box direction="Column" gap="500" alignItems="Center">
              <Box justifyContent="Center">
                <Box grow="Yes" style={{ maxWidth: toRem(300) }} direction="Column" gap="300">
                  <Button
                    as="a"
                    href="https://github.com/LaPingvino/wally"
                    target="_blank"
                    rel="noreferrer noopener"
                    before={<Icon size="200" src={Icons.Code} />}
                  >
                    <Text as="span" size="B400" truncate>
                      Source Code
                    </Text>
                  </Button>
                  <SupportSection />
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
                          href={`https://github.com/LaPingvino/wally/tree/${name}`}
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
