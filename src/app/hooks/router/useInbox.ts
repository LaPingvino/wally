import { useMatch } from 'react-router-dom';
import {
  getInboxActivityPath,
  getInboxInvitesPath,
  getInboxNoticesPath,
  getInboxNotificationsPath,
  getInboxPath,
  getInboxUnreadPath,
} from '../../pages/pathUtils';

export const useInboxSelected = (): boolean => {
  const match = useMatch({
    path: getInboxPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

export const useInboxNotificationsSelected = (): boolean => {
  const match = useMatch({
    path: getInboxNotificationsPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

export const useInboxInvitesSelected = (): boolean => {
  const match = useMatch({
    path: getInboxInvitesPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

export const useInboxUnreadSelected = (): boolean => {
  const match = useMatch({
    path: getInboxUnreadPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

export const useInboxActivitySelected = (): boolean => {
  const match = useMatch({
    path: getInboxActivityPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

export const useInboxNoticesSelected = (): boolean => {
  const match = useMatch({
    path: getInboxNoticesPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};

