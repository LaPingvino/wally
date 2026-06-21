import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IPreviewUrlResponse } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Scroll, Spinner, Text, as, color, config } from 'folds';
import { ImageOverlay } from '../ImageOverlay';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UrlPreview, UrlPreviewContent, UrlPreviewDescription, UrlPreviewImg } from './UrlPreview';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import * as css from './UrlPreviewCard.css';
import { tryDecodeURIComponent } from '../../utils/dom';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ImageViewer } from '../image-viewer';
import { onEnterOrSpace } from '../../utils/keyboard';

const linkStyles = { color: color.Success.Main };

// URL previews are strictly background work. Without throttling, a room full of links fires 100+
// getUrlPreview calls on mount, saturating the browser's ~6-connection-per-host pool and delaying the
// sliding-sync long-poll and outgoing sends queued behind them. Two guards keep the live message path
// snappy: scheduleIdle() defers each fetch to spare time so room-open paints first, and a small
// concurrency cap shapes the initial burst. (The SDK already caches results per url+ts.)
const MAX_CONCURRENT_PREVIEWS = 3;
let activePreviews = 0;
const previewWaiters: Array<() => void> = [];
const acquirePreviewSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activePreviews < MAX_CONCURRENT_PREVIEWS) {
      activePreviews += 1;
      resolve();
    } else {
      previewWaiters.push(resolve);
    }
  });
const releasePreviewSlot = (): void => {
  const next = previewWaiters.shift();
  if (next) next(); // hand the slot straight to the next waiter (in-flight count unchanged)
  else activePreviews -= 1;
};
const scheduleIdle = (): Promise<void> =>
  new Promise((resolve) => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      }
    ).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 0);
  });

export const UrlPreviewCard = as<'div', { url: string; ts: number }>(
  ({ url, ts, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [viewer, setViewer] = useState(false);
    const [previewStatus, loadPreview] = useAsyncCallback(
      // Background priority: yield to idle time, then take a concurrency slot, so previews never block
      // the live message path (sync long-poll, sends, scrolling).
      useCallback(async () => {
        await scheduleIdle();
        await acquirePreviewSlot();
        try {
          return await mx.getUrlPreview(url, ts);
        } finally {
          releasePreviewSlot();
        }
      }, [url, ts, mx])
    );

    // Only fetch once the card is on (or near) screen — off-screen previews must not compete for the
    // connection pool. The 300px rootMargin starts the fetch just before it scrolls into view.
    const cardElRef = useRef<HTMLDivElement | null>(null);
    const [onScreen, setOnScreen] = useState(false);
    const intersectionObserver = useIntersectionObserver(
      useCallback((entries) => {
        const el = cardElRef.current;
        const entry = el && getIntersectionObserverEntry(el, entries);
        if (entry?.isIntersecting) setOnScreen(true);
      }, []),
      useCallback(() => ({ rootMargin: '300px' }), [])
    );
    useEffect(() => {
      const el = cardElRef.current;
      if (el) intersectionObserver?.observe(el);
      return () => {
        if (el) intersectionObserver?.unobserve(el);
      };
    }, [intersectionObserver]);

    // The forwarded ref points at the card root; we also need it for the visibility observer.
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        cardElRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          // eslint-disable-next-line no-param-reassign
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref]
    );

    useEffect(() => {
      if (!onScreen) return;
      // useAsync re-throws after updating state; suppress unhandled-rejection warnings since the
      // error is already handled by the AsyncStatus.Error branch.
      loadPreview().catch(() => undefined);
    }, [onScreen, loadPreview]);

    if (previewStatus.status === AsyncStatus.Error) return null;

    const renderContent = (prev: IPreviewUrlResponse) => {
      const thumbUrl = mxcUrlToHttp(
        mx,
        prev['og:image'] || '',
        useAuthentication,
        256,
        256,
        'scale',
        false
      );

      const imgUrl = mxcUrlToHttp(mx, prev['og:image'] || '', useAuthentication);

      return (
        <>
          {thumbUrl && (
            <UrlPreviewImg
              src={thumbUrl}
              alt={prev['og:title']}
              title={prev['og:title']}
              tabIndex={0}
              onKeyDown={(evt) => onEnterOrSpace(() => setViewer(true))(evt)}
              onClick={() => setViewer(true)}
            />
          )}
          {imgUrl && (
            <ImageOverlay
              src={imgUrl}
              alt={prev['og:title']}
              viewer={viewer}
              requestClose={() => {
                setViewer(false);
              }}
              renderViewer={(p) => <ImageViewer {...p} />}
            />
          )}
          <UrlPreviewContent>
            <Text
              style={linkStyles}
              truncate
              as="a"
              href={url}
              target="_blank"
              rel="noreferrer"
              size="T200"
              priority="300"
            >
              {typeof prev['og:site_name'] === 'string' && `${prev['og:site_name']} | `}
              {tryDecodeURIComponent(url)}
            </Text>
            <Text truncate priority="400">
              <b>{prev['og:title']}</b>
            </Text>
            <Text size="T200" priority="300">
              <UrlPreviewDescription>{prev['og:description']}</UrlPreviewDescription>
            </Text>
          </UrlPreviewContent>
        </>
      );
    };

    return (
      <UrlPreview {...props} ref={setRefs}>
        {previewStatus.status === AsyncStatus.Success ? (
          renderContent(previewStatus.data)
        ) : (
          <Box grow="Yes" alignItems="Center" justifyContent="Center">
            <Spinner variant="Secondary" size="400" />
          </Box>
        )}
      </UrlPreview>
    );
  }
);

export const UrlPreviewHolder = as<'div'>(({ children, ...props }, ref) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const backAnchorRef = useRef<HTMLDivElement>(null);
  const frontAnchorRef = useRef<HTMLDivElement>(null);
  const [backVisible, setBackVisible] = useState(true);
  const [frontVisible, setFrontVisible] = useState(true);

  const intersectionObserver = useIntersectionObserver(
    useCallback((entries) => {
      const backAnchor = backAnchorRef.current;
      const frontAnchor = frontAnchorRef.current;
      const backEntry = backAnchor && getIntersectionObserverEntry(backAnchor, entries);
      const frontEntry = frontAnchor && getIntersectionObserverEntry(frontAnchor, entries);
      if (backEntry) {
        setBackVisible(backEntry.isIntersecting);
      }
      if (frontEntry) {
        setFrontVisible(frontEntry.isIntersecting);
      }
    }, []),
    useCallback(
      () => ({
        root: scrollRef.current,
        rootMargin: '10px',
      }),
      []
    )
  );

  useEffect(() => {
    const backAnchor = backAnchorRef.current;
    const frontAnchor = frontAnchorRef.current;
    if (backAnchor) intersectionObserver?.observe(backAnchor);
    if (frontAnchor) intersectionObserver?.observe(frontAnchor);
    return () => {
      if (backAnchor) intersectionObserver?.unobserve(backAnchor);
      if (frontAnchor) intersectionObserver?.unobserve(frontAnchor);
    };
  }, [intersectionObserver]);

  const handleScrollBack = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const { offsetWidth, scrollLeft } = scroll;
    scroll.scrollTo({
      left: scrollLeft - offsetWidth / 1.3,
      behavior: 'smooth',
    });
  };
  const handleScrollFront = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const { offsetWidth, scrollLeft } = scroll;
    scroll.scrollTo({
      left: scrollLeft + offsetWidth / 1.3,
      behavior: 'smooth',
    });
  };

  return (
    <Box
      direction="Column"
      {...props}
      ref={ref}
      style={{ marginTop: config.space.S200, position: 'relative' }}
    >
      <Scroll ref={scrollRef} direction="Horizontal" size="0" visibility="Hover" hideTrack>
        <Box shrink="No" alignItems="Center">
          <div ref={backAnchorRef} />
          {!backVisible && (
            <>
              <div className={css.UrlPreviewHolderGradient({ position: 'Left' })} />
              <IconButton
                className={css.UrlPreviewHolderBtn({ position: 'Left' })}
                variant="Secondary"
                radii="Pill"
                size="300"
                outlined
                onClick={handleScrollBack}
              >
                <Icon size="300" src={Icons.ArrowLeft} />
              </IconButton>
            </>
          )}
          <Box alignItems="Inherit" gap="200">
            {children}

            {!frontVisible && (
              <>
                <div className={css.UrlPreviewHolderGradient({ position: 'Right' })} />
                <IconButton
                  className={css.UrlPreviewHolderBtn({ position: 'Right' })}
                  variant="Primary"
                  radii="Pill"
                  size="300"
                  outlined
                  onClick={handleScrollFront}
                >
                  <Icon size="300" src={Icons.ArrowRight} />
                </IconButton>
              </>
            )}
            <div ref={frontAnchorRef} />
          </Box>
        </Box>
      </Scroll>
    </Box>
  );
});
