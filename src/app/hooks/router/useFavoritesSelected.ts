import { useMatch } from 'react-router-dom';
import { getFavoritesPath } from '../../pages/pathUtils';

export const useFavoritesSelected = (): boolean => {
  const match = useMatch({ path: getFavoritesPath(), caseSensitive: true, end: false });
  return !!match;
};
