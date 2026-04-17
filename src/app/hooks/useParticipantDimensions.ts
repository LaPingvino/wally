import { useEffect, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

export interface TileDimensions {
  width: number;
  height: number;
}

/**
 * Tracks the source dimensions (width × height in pixels) of each participant's
 * active video publication — screenshare if present, camera otherwise.
 *
 * The layout packer uses this to pick cell shapes that minimize letterboxing.
 * Participants without dimensions yet (track not subscribed, camera off) are
 * omitted from the map — callers should fall back to a sensible default
 * (16:9 for cameras, 16:10 for shares).
 */
export function useParticipantDimensions(lkRoom: Room | null): Map<string, TileDimensions> {
  const [dims, setDims] = useState<Map<string, TileDimensions>>(new Map());

  useEffect(() => {
    if (!lkRoom) {
      setDims(new Map());
      return;
    }

    const snapshot = () => {
      const all = [lkRoom.localParticipant, ...Array.from(lkRoom.remoteParticipants.values())];
      const next = new Map<string, TileDimensions>();
      for (const p of all) {
        const share = p.getTrackPublication(Track.Source.ScreenShare);
        const cam = p.getTrackPublication(Track.Source.Camera);
        const pub = share?.track ? share : cam;
        const d = pub?.dimensions;
        if (d && d.width > 0 && d.height > 0) {
          next.set(p.sid, { width: d.width, height: d.height });
        }
      }
      setDims((prev) => {
        if (prev.size !== next.size) return next;
        for (const [k, v] of next) {
          const pv = prev.get(k);
          if (!pv || pv.width !== v.width || pv.height !== v.height) return next;
        }
        return prev;
      });
    };

    snapshot();
    lkRoom.on(RoomEvent.TrackSubscribed, snapshot);
    lkRoom.on(RoomEvent.TrackUnsubscribed, snapshot);
    lkRoom.on(RoomEvent.TrackMuted, snapshot);
    lkRoom.on(RoomEvent.TrackUnmuted, snapshot);
    lkRoom.on(RoomEvent.LocalTrackPublished, snapshot);
    lkRoom.on(RoomEvent.LocalTrackUnpublished, snapshot);
    lkRoom.on(RoomEvent.ParticipantConnected, snapshot);
    lkRoom.on(RoomEvent.ParticipantDisconnected, snapshot);

    return () => {
      lkRoom.off(RoomEvent.TrackSubscribed, snapshot);
      lkRoom.off(RoomEvent.TrackUnsubscribed, snapshot);
      lkRoom.off(RoomEvent.TrackMuted, snapshot);
      lkRoom.off(RoomEvent.TrackUnmuted, snapshot);
      lkRoom.off(RoomEvent.LocalTrackPublished, snapshot);
      lkRoom.off(RoomEvent.LocalTrackUnpublished, snapshot);
      lkRoom.off(RoomEvent.ParticipantConnected, snapshot);
      lkRoom.off(RoomEvent.ParticipantDisconnected, snapshot);
    };
  }, [lkRoom]);

  return dims;
}
