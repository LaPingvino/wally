import React, { ReactNode } from 'react';
import { NativeDialog } from './NativeDialog';
import * as dialogCss from './NativeDialog.css';

type Modal500Props = {
  requestClose: () => void;
  children: ReactNode;
};
export function Modal500({ requestClose, children }: Modal500Props) {
  return (
    <NativeDialog open onClose={requestClose} className={dialogCss.NativeDialog}>
      {children}
    </NativeDialog>
  );
}
