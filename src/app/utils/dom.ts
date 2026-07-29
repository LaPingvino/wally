export const targetFromEvent = (evt: Event, selector: string): Element | undefined => {
  const targets = evt.composedPath() as Element[];
  return targets.find((target) => target.matches?.(selector));
};

export const editableActiveElement = (): boolean =>
  !!document.activeElement &&
  (document.activeElement.nodeName.toLowerCase() === 'input' ||
    document.activeElement.nodeName.toLowerCase() === 'textarea' ||
    document.activeElement.getAttribute('contenteditable') === 'true' ||
    document.activeElement.getAttribute('role') === 'input' ||
    document.activeElement.getAttribute('role') === 'textarea');

export const isIntersectingScrollView = (
  scrollElement: HTMLElement,
  childElement: HTMLElement
): boolean => {
  const scrollTop = scrollElement.offsetTop + scrollElement.scrollTop;
  const scrollBottom = scrollTop + scrollElement.offsetHeight;

  const childTop = childElement.offsetTop;
  const childBottom = childTop + childElement.clientHeight;

  if (childTop >= scrollTop && childTop < scrollBottom) return true;
  if (childBottom > scrollTop && childBottom <= scrollBottom) return true;
  if (childTop < scrollTop && childBottom > scrollBottom) return true;
  return false;
};

export const isInScrollView = (scrollElement: HTMLElement, childElement: HTMLElement): boolean => {
  const scrollTop = scrollElement.offsetTop + scrollElement.scrollTop;
  const scrollBottom = scrollTop + scrollElement.offsetHeight;
  return (
    childElement.offsetTop >= scrollTop &&
    childElement.offsetTop + childElement.offsetHeight <= scrollBottom
  );
};

export const canFitInScrollView = (
  scrollElement: HTMLElement,
  childElement: HTMLElement
): boolean => childElement.offsetHeight < scrollElement.offsetHeight;

export type FilesOrFile<T extends boolean | undefined = undefined> = T extends true ? File[] : File;

export const getFilesFromFileList = (fileList: FileList): File[] => {
  const files: File[] = [];

  for (let i = 0; i < fileList.length; i += 1) {
    const file: File | undefined = fileList[i];
    if (file instanceof File) files.push(file);
  }

  return files;
};

export const selectFile = <M extends boolean | undefined = undefined>(
  accept: string,
  multiple?: M
): Promise<FilesOrFile<M> | undefined> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;

    const changeHandler = () => {
      const fileList = input.files;
      if (!fileList) {
        resolve(undefined);
      } else {
        const files: File[] = getFilesFromFileList(fileList);
        resolve((multiple ? files : files[0]) as FilesOrFile<M>);
      }
      input.removeEventListener('change', changeHandler);
    };

    input.addEventListener('change', changeHandler);
    input.click();
  });

export const getDataTransferFiles = (dataTransfer: DataTransfer): File[] | undefined => {
  const fileList = dataTransfer.files;
  const files: File[] = getFilesFromFileList(fileList);
  if (files.length === 0) return undefined;
  return files;
};

export const renameFile = (file: File, name: string): File =>
  new File([file], name, { type: file.type });

export const getImageUrlBlob = async (url: string) => {
  const res = await fetch(url);
  const blob = await res.blob();
  return blob;
};

export const getImageFileUrl = (fileOrBlob: File | Blob) => URL.createObjectURL(fileOrBlob);

export const getVideoFileUrl = (fileOrBlob: File | Blob) => URL.createObjectURL(fileOrBlob);

export const loadImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });

export const loadVideoElement = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;

    video.onloadeddata = () => {
      resolve(video);
      video.pause();
    };
    video.onerror = (e) => {
      reject(e);
    };

    video.src = url;
    video.load();
    video.play();
  });

export const getThumbnailDimensions = (width: number, height: number): [number, number] => {
  const MAX_WIDTH = 400;
  const MAX_HEIGHT = 300;
  let targetWidth = width;
  let targetHeight = height;
  if (targetHeight > MAX_HEIGHT) {
    targetWidth = Math.floor(targetWidth * (MAX_HEIGHT / targetHeight));
    targetHeight = MAX_HEIGHT;
  }
  if (targetWidth > MAX_WIDTH) {
    targetHeight = Math.floor(targetHeight * (MAX_WIDTH / targetWidth));
    targetWidth = MAX_WIDTH;
  }
  return [targetWidth, targetHeight];
};

export const getThumbnail = (
  img: HTMLImageElement | SVGImageElement | HTMLVideoElement,
  width: number,
  height: number,
  thumbnailMimeType?: string
): Promise<Blob | undefined> =>
  new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      resolve(undefined);
      return;
    }
    context.drawImage(img, 0, 0, width, height);

    canvas.toBlob((thumbnail) => {
      resolve(thumbnail ?? undefined);
    }, thumbnailMimeType ?? 'image/jpeg');
  });

export type ScrollInfo = {
  offsetTop: number;
  top: number;
  height: number;
  viewHeight: number;
  scrollable: boolean;
};
export const getScrollInfo = (target: HTMLElement): ScrollInfo => ({
  offsetTop: Math.round(target.offsetTop),
  top: Math.round(target.scrollTop),
  height: Math.round(target.scrollHeight),
  viewHeight: Math.round(target.offsetHeight),
  scrollable: target.scrollHeight > target.offsetHeight,
});

export const scrollToBottom = (scrollEl: HTMLElement, behavior?: 'auto' | 'instant' | 'smooth') => {
  scrollEl.scrollTo({
    top: Math.round(scrollEl.scrollHeight - scrollEl.offsetHeight),
    behavior,
  });
};

export const copyToClipboard = (text: string) => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    const host = document.body;
    const copyInput = document.createElement('input');
    copyInput.style.position = 'fixed';
    copyInput.style.opacity = '0';
    copyInput.value = text;
    host.append(copyInput);

    copyInput.select();
    copyInput.setSelectionRange(0, 99999);
    document.execCommand('Copy');
    copyInput.remove();
  }
};

export const setFavicon = (url: string): void => {
  const favicon = document.querySelector('#favicon');
  if (!favicon) return;
  favicon.setAttribute('href', url);
};

export const tryDecodeURIComponent = (encodedURIComponent: string): string => {
  try {
    return decodeURIComponent(encodedURIComponent);
  } catch {
    return encodedURIComponent;
  }
};

export const syntaxErrorPosition = (error: SyntaxError): number | undefined => {
  const match = error.message.match(/position\s(\d+)\s/);
  if (!match) return undefined;

  const posStr = match[1];
  const position = parseInt(posStr, 10);
  if (Number.isNaN(position)) return undefined;
  return position;
};

export const notificationPermission = (permission: NotificationPermission) => {
  if ('Notification' in window) {
    return window.Notification.permission === permission;
  }
  return false;
};

/**
 * Raise a desktop notification, on every platform or not at all — but never by
 * throwing.
 *
 * `notificationPermission('granted')` is a permission check, and permission is
 * NOT capability. On Android Chrome the Notification API exists and reports
 * `granted`, yet `new Notification()` throws `TypeError: Illegal constructor`:
 * notifications there may only be raised through the service worker
 * (https://issues.chromium.org/issues/40415865). Every caller had that
 * constructor sitting bare inside a sync handler, so on Android the throw took
 * out the handler that raised it — a timeline listener — rather than merely
 * losing a notification.
 *
 * Probing by CONSTRUCTING a notification would be worse than the bug (the probe
 * itself pops an empty notification), so we don't feature-detect: we try the
 * direct path, and on failure hand off to the service worker, which is the
 * supported route on exactly the platforms where the constructor fails. If that
 * is unavailable too, the notification is dropped — silence is an acceptable
 * outcome here, a crash is not.
 *
 * The service-worker path can't carry `onClick`: activating those notifications
 * needs a `notificationclick` handler inside the worker. Until we add one,
 * Android gets the notification without the click-to-navigate.
 *
 * Returns the Notification when the direct path worked, so a caller can close
 * it later (replacing its own previous one); `undefined` on the fallback path,
 * where there is no handle to hold.
 */
export const showNotification = (
  title: string,
  options: NotificationOptions,
  onClick?: () => void
): Notification | undefined => {
  try {
    const notification = new window.Notification(title, options);
    if (onClick) {
      notification.onclick = () => {
        onClick();
        notification.close();
      };
    }
    return notification;
  } catch {
    navigator.serviceWorker?.ready
      .then((registration) => registration.showNotification(title, options))
      .catch(() => {
        // no service worker, or it refused too — drop the notification
      });
    return undefined;
  }
};

export const getMouseEventCords = (event: MouseEvent) => ({
  x: event.clientX,
  y: event.clientY,
  width: 0,
  height: 0,
});
