import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { useMatrixClient } from './useMatrixClient';
import { getAccountData, isSpace } from '../utils/room';
import { Membership } from '../../types/matrix/room';
import { useAccountDataCallback } from './useAccountDataCallback';

export type ISidebarFolder = {
  name?: string;
  id: string;
  content: string[];
  // When set, this folder is a display-only ("derived") folder synthesized from the
  // subspaces of the given space id. Derived folders are NEVER persisted in the
  // `sidebar` account-data list — they are rebuilt on the fly from the space hierarchy
  // (see SpaceTabs). Drag-and-drop into/out of them is disabled.
  derivedFromSpace?: string;
};
export type TSidebarItem = string | ISidebarFolder;
export type SidebarItems = Array<TSidebarItem>;

export type InCinnySpacesContent = {
  shortcut?: string[];
  sidebar?: SidebarItems;
  // Space ids the user has chosen to render in the sidebar as a collapsible folder of
  // their subspaces (Discord-style grouping) instead of a single icon whose room list
  // nests the subspaces as headers.
  subspaceFolders?: string[];
};

export const parseSidebar = (
  mx: MatrixClient,
  orphanSpaces: string[],
  content?: InCinnySpacesContent
) => {
  const sidebar = content?.sidebar ?? content?.shortcut ?? [];
  const orphans = new Set(orphanSpaces);

  const items: SidebarItems = [];

  const safeToAdd = (spaceId: string): boolean => {
    if (typeof spaceId !== 'string') return false;
    const space = mx.getRoom(spaceId);
    if (space?.getMyMembership() !== Membership.Join) return false;
    return isSpace(space);
  };

  sidebar.forEach((item) => {
    if (typeof item === 'string') {
      if (safeToAdd(item) && !items.includes(item)) {
        orphans.delete(item);
        items.push(item);
      }
      return;
    }
    if (
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      Array.isArray(item.content) &&
      !items.find((i) => (typeof i === 'string' ? false : i.id === item.id))
    ) {
      const safeContent = item.content.filter(safeToAdd);
      safeContent.forEach((i) => orphans.delete(i));
      items.push({
        ...item,
        content: Array.from(new Set(safeContent)),
      });
    }
  });

  orphans.forEach((spaceId) => items.push(spaceId));
  return items;
};

export const useSidebarItems = (
  orphanSpaces: string[]
): [SidebarItems, Dispatch<SetStateAction<SidebarItems>>] => {
  const mx = useMatrixClient();

  const [sidebarItems, setSidebarItems] = useState(() => {
    const inCinnySpacesContent = getAccountData(
      mx,
      AccountDataEvent.CinnySpaces
    )?.getContent<InCinnySpacesContent>();
    return parseSidebar(mx, orphanSpaces, inCinnySpacesContent);
  });

  useEffect(() => {
    const inCinnySpacesContent = getAccountData(
      mx,
      AccountDataEvent.CinnySpaces
    )?.getContent<InCinnySpacesContent>();
    setSidebarItems(parseSidebar(mx, orphanSpaces, inCinnySpacesContent));
  }, [mx, orphanSpaces]);

  useAccountDataCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === AccountDataEvent.CinnySpaces) {
          const newContent = mEvent.getContent<InCinnySpacesContent>();
          setSidebarItems(parseSidebar(mx, orphanSpaces, newContent));
        }
      },
      [mx, orphanSpaces]
    )
  );

  return [sidebarItems, setSidebarItems];
};

export const sidebarItemWithout = (items: SidebarItems, roomId: string) => {
  const newItems: SidebarItems = items
    .map((item) => {
      if (typeof item === 'string') {
        if (item === roomId) return null;
        return item;
      }
      if (item.content.includes(roomId)) {
        const newContent = item.content.filter((id) => id !== roomId);
        if (newContent.length === 0) return null;
        return {
          ...item,
          content: newContent,
        };
      }
      return item;
    })
    .filter((item) => item !== null) as SidebarItems;

  return newItems;
};

const readSubspaceFolders = (content?: InCinnySpacesContent): string[] => {
  const folders = content?.subspaceFolders;
  return Array.isArray(folders) ? folders : [];
};

export const getSubspaceFolders = (mx: MatrixClient): string[] =>
  readSubspaceFolders(
    getAccountData(mx, AccountDataEvent.CinnySpaces)?.getContent<InCinnySpacesContent>()
  );

// Build an `in.cinny.spaces` payload that toggles a single space's subspace-folder mode
// while preserving every other field (sidebar order, folders, shortcut).
export const makeSubspaceFoldersContent = (
  mx: MatrixClient,
  spaceId: string,
  enabled: boolean
): InCinnySpacesContent => {
  const current =
    getAccountData(mx, AccountDataEvent.CinnySpaces)?.getContent<InCinnySpacesContent>() ?? {};
  const set = new Set(readSubspaceFolders(current));
  if (enabled) set.add(spaceId);
  else set.delete(spaceId);
  return { ...current, subspaceFolders: Array.from(set) };
};

// Reactive list of space ids in subspace-folder mode; updates when `in.cinny.spaces`
// changes (including from other devices, since it lives in account data).
export const useSubspaceFolders = (): string[] => {
  const mx = useMatrixClient();
  const [folders, setFolders] = useState<string[]>(() => getSubspaceFolders(mx));

  useAccountDataCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === AccountDataEvent.CinnySpaces) {
          setFolders(readSubspaceFolders(mEvent.getContent<InCinnySpacesContent>()));
        }
      },
      []
    )
  );

  return folders;
};

export const makeCinnySpacesContent = (
  mx: MatrixClient,
  items: SidebarItems
): InCinnySpacesContent => {
  const currentInSpaces =
    getAccountData(mx, AccountDataEvent.CinnySpaces)?.getContent<InCinnySpacesContent>() ?? {};

  const newSpacesContent: InCinnySpacesContent = {
    ...currentInSpaces,
    sidebar: items,
  };

  return newSpacesContent;
};
