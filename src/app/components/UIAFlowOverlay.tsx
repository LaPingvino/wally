import React, { ReactNode } from 'react';
import {
  Box,
  config,
  Text,
  TooltipProvider,
  Tooltip,
  Icons,
  Icon,
  Chip,
  IconButton,
} from 'folds';
import { NativeDialog } from './NativeDialog';
import * as dialogCss from './NativeDialog.css';

export type UIAFlowOverlayProps = {
  currentStep: number;
  stepCount: number;
  children: ReactNode;
  onCancel: () => void;
};
export function UIAFlowOverlay({
  currentStep,
  stepCount,
  children,
  onCancel,
}: UIAFlowOverlayProps) {
  return (
    <NativeDialog open onClose={onCancel} className={dialogCss.NativeDialog}>
      <Box style={{ height: '100%' }} direction="Column" grow="Yes" gap="400">
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center">
          {children}
        </Box>
        <Box
          style={{ padding: config.space.S200 }}
          shrink="No"
          justifyContent="Center"
          alignItems="Center"
          gap="200"
        >
          <Chip as="div" radii="Pill" outlined>
            <Text as="span" size="T300">{`Step ${currentStep}/${stepCount}`}</Text>
          </Chip>
          <TooltipProvider
            tooltip={
              <Tooltip variant="Critical">
                <Text>Exit</Text>
              </Tooltip>
            }
            position="Top"
          >
            {(anchorRef) => (
              <IconButton
                ref={anchorRef}
                variant="Critical"
                size="300"
                onClick={onCancel}
                radii="Pill"
                outlined
              >
                <Icon size="50" src={Icons.Cross} />
              </IconButton>
            )}
          </TooltipProvider>
        </Box>
      </Box>
    </NativeDialog>
  );
}
