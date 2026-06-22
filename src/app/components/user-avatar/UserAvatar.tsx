import { AvatarFallback, AvatarImage, color } from 'folds';
import React, { ReactEventHandler, ReactNode } from 'react';
import classNames from 'classnames';
import * as css from './UserAvatar.css';
import colorMXID from '../../../util/colorMXID';
import { useImageRetry } from '../../hooks/useImageRetry';

type UserAvatarProps = {
  className?: string;
  userId: string;
  src?: string;
  alt?: string;
  renderFallback: () => ReactNode;
};
export function UserAvatar({ className, userId, src, alt, renderFallback }: UserAvatarProps) {
  // Retry the load (SW/token may not be ready yet on a refresh) before falling back.
  const { retryKey, failed, onError } = useImageRetry(src);

  const handleLoad: ReactEventHandler<HTMLImageElement> = (evt) => {
    evt.currentTarget.setAttribute('data-image-loaded', 'true');
  };

  if (!src || failed) {
    return (
      <AvatarFallback
        style={{ backgroundColor: colorMXID(userId), color: color.Surface.Container }}
        className={classNames(css.UserAvatar, className)}
        role="img"
        aria-label={alt ?? undefined}
      >
        {renderFallback()}
      </AvatarFallback>
    );
  }

  return (
    <AvatarImage
      key={retryKey}
      className={classNames(css.UserAvatar, className)}
      src={src}
      alt={alt}
      onError={onError}
      onLoad={handleLoad}
      draggable={false}
    />
  );
}
