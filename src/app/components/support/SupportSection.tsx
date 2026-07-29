import React, { useEffect, useState } from 'react';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { copyToClipboard } from '../../utils/dom';
import { announce } from '../../utils/announce';
import BchQrPNG from '../../../../public/res/bch-qr.png';

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

export function SupportSection() {
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
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
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              onClick={() => setShowQr(!showQr)}
              aria-expanded={showQr}
              aria-controls="support-bch-qr"
            >
              <Text as="span" size="B300">
                QR
              </Text>
            </Button>
          </Box>
          {showQr && (
            <Box id="support-bch-qr" justifyContent="Center">
              <a href={SUPPORT_BCH}>
                <img
                  src={BchQrPNG}
                  alt={`Bitcoin Cash QR code for ${SUPPORT_BCH}`}
                  width="185"
                  height="185"
                  loading="lazy"
                />
              </a>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
