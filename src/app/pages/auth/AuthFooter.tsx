import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';
import { APP_VERSION } from '../../version';

export function AuthFooter() {
  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text as="a" size="T300" href="https://codeberg.org/lapingvino/cinny" target="_blank" rel="noreferrer">
        About
      </Text>
      <Text
        as="a"
        size="T300"
        href="https://codeberg.org/lapingvino/cinny/releases"
        target="_blank"
        rel="noreferrer"
      >
        v{APP_VERSION}
      </Text>
      <Text as="a" size="T300" href="https://matrix.org" target="_blank" rel="noreferrer">
        Powered by Matrix
      </Text>
      <Text
        as="a"
        size="T300"
        href="https://codeberg.org/lapingvino/cinny"
        target="_blank"
        rel="noreferrer"
      >
        Source Code
      </Text>
    </Box>
  );
}
