import { JoinRule } from 'matrix-js-sdk';
import { AvatarFallback, AvatarImage, Icon, Icons, color } from 'folds';
import React, { ComponentProps, ReactEventHandler, ReactNode, forwardRef } from 'react';
import * as css from './RoomAvatar.css';
import { getRoomIconSrc } from '../../utils/room';
import colorMXID from '../../../util/colorMXID';
import { useImageRetry } from '../../hooks/useImageRetry';

type RoomAvatarProps = {
  roomId: string;
  src?: string;
  alt?: string;
  renderFallback: () => ReactNode;
};
export function RoomAvatar({ roomId, src, alt, renderFallback }: RoomAvatarProps) {
  // Retry the load (SW/token may not be ready yet on a refresh) before falling back.
  const { retryKey, failed, onError } = useImageRetry(src);

  const handleLoad: ReactEventHandler<HTMLImageElement> = (evt) => {
    evt.currentTarget.setAttribute('data-image-loaded', 'true');
  };

  if (!src || failed) {
    return (
      <AvatarFallback
        style={{ backgroundColor: colorMXID(roomId ?? ''), color: color.Surface.Container }}
        className={css.RoomAvatar}
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
      className={css.RoomAvatar}
      src={src}
      alt={alt}
      onError={onError}
      onLoad={handleLoad}
      draggable={false}
    />
  );
}

export const RoomIcon = forwardRef<
  SVGSVGElement,
  Omit<ComponentProps<typeof Icon>, 'src'> & {
    joinRule?: JoinRule;
    roomType?: string;
    locked?: boolean;
  }
>(({ joinRule, roomType, locked, ...props }, ref) => (
  <Icon src={getRoomIconSrc(Icons, roomType, joinRule, locked)} {...props} ref={ref} />
));
