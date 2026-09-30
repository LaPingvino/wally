import { ReactNode, useCallback, useEffect } from 'react';
import { IThumbnailContent } from '../../../../types/matrix/common';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { decryptFile, downloadEncryptedMedia, mxcUrlToHttp } from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { FALLBACK_MIMETYPE } from '../../../utils/mimeTypes';

export type ThumbnailContentProps = {
  info: IThumbnailContent;
  renderImage: (src: string) => ReactNode;
};
export function ThumbnailContent({ info, renderImage }: ThumbnailContentProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [thumbSrcState, loadThumbSrc] = useAsyncCallback(
    useCallback(async () => {
      const thumbInfo = info.thumbnail_info;
      const thumbMxcUrl = info.thumbnail_file?.url ?? info.thumbnail_url;
      const encInfo = info.thumbnail_file;
      // Only the URL is required: thumbnail_info (and its mimetype) is optional per spec and
      // bridged media (WhatsApp/Signal) often omits it. The mimetype only matters for
      // decrypting, which already falls back to FALLBACK_MIMETYPE.
      if (typeof thumbMxcUrl !== 'string') {
        throw new Error('Failed to load thumbnail');
      }

      const mediaUrl = mxcUrlToHttp(mx, thumbMxcUrl, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      if (encInfo) {
        const fileContent = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
          decryptFile(encBuf, thumbInfo?.mimetype ?? FALLBACK_MIMETYPE, encInfo)
        );
        return URL.createObjectURL(fileContent);
      }

      return mediaUrl;
    }, [mx, info, useAuthentication])
  );

  useEffect(() => {
    // The hook records failures in thumbSrcState (we then render nothing) AND rethrows;
    // swallow the rethrow so a missing thumbnail isn't an "Uncaught (in promise)" per message.
    loadThumbSrc().catch(() => undefined);
  }, [loadThumbSrc]);

  return thumbSrcState.status === AsyncStatus.Success ? renderImage(thumbSrcState.data) : null;
}
