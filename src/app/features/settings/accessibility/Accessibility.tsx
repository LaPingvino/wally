import React, { useEffect, useState } from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Badge } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';

type A11yStats = {
  landmarks: {
    nav: number;
    main: number;
    region: number;
    complementary: number;
    banner: number;
    contentinfo: number;
    form: number;
    search: number;
  };
  dialogs: {
    nativeDialog: number;
    legacyOverlay: number;
    openDialogs: number;
  };
  interactive: {
    buttonsWithLabel: number;
    buttonsWithoutLabel: number;
    imagesWithAlt: number;
    imagesWithoutAlt: number;
    inputsWithLabel: number;
    inputsWithoutLabel: number;
  };
  keyboard: {
    focusableElements: number;
    tabStops: number;
    listboxes: number;
    ariaActivedescendant: number;
  };
  live: {
    ariaLiveRegions: number;
    roleAlert: number;
    roleStatus: number;
    roleLog: number;
  };
};

function auditDOM(): A11yStats {
  const q = (sel: string) => document.querySelectorAll(sel).length;

  // Buttons: <button>, [role="button"], <a> with no text
  const allButtons = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
  let buttonsWithLabel = 0;
  let buttonsWithoutLabel = 0;
  allButtons.forEach((btn) => {
    const label = btn.getAttribute('aria-label')
      || btn.getAttribute('aria-labelledby')
      || btn.textContent?.trim();
    if (label) buttonsWithLabel++;
    else buttonsWithoutLabel++;
  });

  const allImages = document.querySelectorAll('img');
  let imagesWithAlt = 0;
  let imagesWithoutAlt = 0;
  allImages.forEach((img) => {
    if (img.alt || img.getAttribute('role') === 'presentation') imagesWithAlt++;
    else imagesWithoutAlt++;
  });

  const allInputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
  let inputsWithLabel = 0;
  let inputsWithoutLabel = 0;
  allInputs.forEach((input) => {
    const hasLabel = input.getAttribute('aria-label')
      || input.getAttribute('aria-labelledby')
      || input.id && document.querySelector(`label[for="${input.id}"]`)
      || input.closest('label');
    if (hasLabel) inputsWithLabel++;
    else inputsWithoutLabel++;
  });

  // Focusable elements (approximate)
  const focusable = document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]'
  );
  const tabStops = Array.from(focusable).filter(
    (el) => (el as HTMLElement).tabIndex >= 0
  ).length;

  return {
    landmarks: {
      nav: q('nav, [role="navigation"]'),
      main: q('main, [role="main"]'),
      region: q('[role="region"][aria-label]'),
      complementary: q('aside, [role="complementary"]'),
      banner: q('header[role="banner"], [role="banner"]'),
      contentinfo: q('footer[role="contentinfo"], [role="contentinfo"]'),
      form: q('form[aria-label], form[aria-labelledby], [role="form"]'),
      search: q('[role="search"]'),
    },
    dialogs: {
      nativeDialog: q('dialog'),
      legacyOverlay: q('[data-overlay]'),
      openDialogs: q('dialog[open]'),
    },
    interactive: {
      buttonsWithLabel,
      buttonsWithoutLabel,
      imagesWithAlt,
      imagesWithoutAlt,
      inputsWithLabel,
      inputsWithoutLabel,
    },
    keyboard: {
      focusableElements: focusable.length,
      tabStops,
      listboxes: q('[role="listbox"]'),
      ariaActivedescendant: q('[aria-activedescendant]'),
    },
    live: {
      ariaLiveRegions: q('[aria-live]'),
      roleAlert: q('[role="alert"]'),
      roleStatus: q('[role="status"]'),
      roleLog: q('[role="log"]'),
    },
  };
}

function StatusBadge({ good }: { good: boolean }) {
  return (
    <Badge
      size="300"
      variant={good ? 'Success' : 'Critical'}
      fill="Soft"
      radii="Pill"
    >
      <Text size="L400">{good ? 'Good' : 'Fix'}</Text>
    </Badge>
  );
}

type AccessibilityProps = {
  requestClose: () => void;
};

export function Accessibility({ requestClose }: AccessibilityProps) {
  const [stats, setStats] = useState<A11yStats | null>(null);

  useEffect(() => {
    // Delay to let the page render
    const id = setTimeout(() => setStats(auditDOM()), 200);
    return () => clearTimeout(id);
  }, []);

  const refresh = () => setStats(auditDOM());

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Accessibility
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
              {!stats ? (
                <Text>Scanning...</Text>
              ) : (
                <>
                  {/* Landmarks */}
                  <Box direction="Column" gap="100">
                    <Text size="L400">ARIA Landmarks</Text>
                    <Text size="T200" priority="300">
                      Screen readers use landmarks to jump between page sections. Add role="navigation", role="main", role="region" with aria-label to your layout containers.
                    </Text>
                    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
                      <SettingTile
                        title="Navigation (<nav>)"
                        description={`${stats.landmarks.nav} found`}
                        after={<StatusBadge good={stats.landmarks.nav > 0} />}
                      />
                      <SettingTile
                        title="Main (<main>)"
                        description={`${stats.landmarks.main} found`}
                        after={<StatusBadge good={stats.landmarks.main > 0} />}
                      />
                      <SettingTile
                        title="Regions (role='region' + aria-label)"
                        description={`${stats.landmarks.region} found — panels, drawers, and widgets auto-discovered for F6 cycling`}
                        after={<StatusBadge good={stats.landmarks.region >= 0} />}
                      />
                      <SettingTile
                        title="Log (role='log')"
                        description={`${stats.live.roleLog} found — message timeline announces new content`}
                        after={<StatusBadge good={stats.live.roleLog > 0} />}
                      />
                    </SequenceCard>
                  </Box>

                  {/* Dialogs */}
                  <Box direction="Column" gap="100">
                    <Text size="L400">Dialogs</Text>
                    <Text size="T200" priority="300">
                      Native &lt;dialog&gt; with showModal() gives free focus trapping, Escape-to-close, inert backgrounds, and return-focus. Replace custom Overlay+FocusTrap patterns with it.
                    </Text>
                    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
                      <SettingTile
                        title="Native <dialog> elements"
                        description={`${stats.dialogs.nativeDialog} in DOM (${stats.dialogs.openDialogs} currently open)`}
                        after={<StatusBadge good={stats.dialogs.nativeDialog >= 0} />}
                      />
                    </SequenceCard>
                  </Box>

                  {/* Interactive elements */}
                  <Box direction="Column" gap="100">
                    <Text size="L400">Interactive Elements</Text>
                    <Text size="T200" priority="300">
                      Every button, image, and input needs an accessible name. Use aria-label for icon buttons, alt for images, and associate labels with inputs via htmlFor or aria-labelledby.
                    </Text>
                    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
                      <SettingTile
                        title="Buttons with accessible name"
                        description={`${stats.interactive.buttonsWithLabel} of ${stats.interactive.buttonsWithLabel + stats.interactive.buttonsWithoutLabel}`}
                        after={<StatusBadge good={stats.interactive.buttonsWithoutLabel === 0} />}
                      />
                      <SettingTile
                        title="Images with alt text"
                        description={`${stats.interactive.imagesWithAlt} of ${stats.interactive.imagesWithAlt + stats.interactive.imagesWithoutAlt}`}
                        after={<StatusBadge good={stats.interactive.imagesWithoutAlt === 0} />}
                      />
                      <SettingTile
                        title="Inputs with label"
                        description={`${stats.interactive.inputsWithLabel} of ${stats.interactive.inputsWithLabel + stats.interactive.inputsWithoutLabel}`}
                        after={<StatusBadge good={stats.interactive.inputsWithoutLabel === 0} />}
                      />
                    </SequenceCard>
                  </Box>

                  {/* Keyboard */}
                  <Box direction="Column" gap="100">
                    <Text size="L400">Keyboard Navigation</Text>
                    <Text size="T200" priority="300">
                      Lists should be a single tab stop using role="listbox" with aria-activedescendant — arrow keys navigate within. F6 cycles between major sections. Use Tab sparingly.
                    </Text>
                    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
                      <SettingTile
                        title="Tab stops"
                        description={`${stats.keyboard.tabStops} elements reachable by Tab`}
                      />
                      <SettingTile
                        title="Listboxes (single tab stop lists)"
                        description={`${stats.keyboard.listboxes} using role="listbox"`}
                        after={<StatusBadge good={stats.keyboard.listboxes > 0} />}
                      />
                      <SettingTile
                        title="aria-activedescendant"
                        description={`${stats.keyboard.ariaActivedescendant} containers manage focus without moving DOM focus`}
                        after={<StatusBadge good={stats.keyboard.ariaActivedescendant > 0} />}
                      />
                    </SequenceCard>
                  </Box>

                  {/* Live regions */}
                  <Box direction="Column" gap="100">
                    <Text size="L400">Live Regions</Text>
                    <Text size="T200" priority="300">
                      aria-live regions announce dynamic content changes. role="log" for message timelines, role="status" for transient updates, aria-live="polite" for non-urgent changes.
                    </Text>
                    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
                      <SettingTile
                        title="aria-live regions"
                        description={`${stats.live.ariaLiveRegions} total`}
                        after={<StatusBadge good={stats.live.ariaLiveRegions > 0} />}
                      />
                      <SettingTile
                        title="Alert / Status roles"
                        description={`${stats.live.roleAlert} alerts, ${stats.live.roleStatus} status`}
                      />
                    </SequenceCard>
                  </Box>

                  {/* How to apply */}
                  <Box direction="Column" gap="100">
                    <Text size="L400">Apply This to Your Codebase</Text>
                    <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
                      <SettingTile
                        title="1. Add landmarks"
                        description="Wrap your sidebar in <nav aria-label='...'>, main content in <main>, and panels in <div role='region' aria-label='...'>"
                      />
                      <SettingTile
                        title="2. Use native <dialog>"
                        description="Replace custom modal overlays with <dialog>.showModal() — gives focus trapping, Escape, inert backdrop, and return-focus for free"
                      />
                      <SettingTile
                        title="3. Single tab stop lists"
                        description="Give the list container tabIndex={0} and role='listbox'. Items get role='option' and tabIndex={-1}. Use aria-activedescendant + arrow keys"
                      />
                      <SettingTile
                        title="4. Label everything"
                        description="Every <button> without visible text needs aria-label. Every <img> needs alt. Every <input> needs a <label> or aria-label"
                      />
                      <SettingTile
                        title="5. Test with a screen reader"
                        description="NVDA (Windows, free), VoiceOver (Mac, built-in), Orca (Linux, built-in). Navigate your app with Tab, arrows, and F6 — if you get lost, your users will too"
                      />
                    </SequenceCard>
                  </Box>
                </>
              )}
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
