import { useCallback } from 'react';
import z from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Capabilities, MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useSpecVersions } from './useSpecVersions';
import { IProfileFieldsCapability } from '../../types/matrix/common';

const extendedProfile = z.looseObject({
  displayname: z.string().optional(),
  avatar_url: z.string().optional(),
  'io.fsky.nyx.pronouns': z
    .object({
      language: z.string(),
      summary: z.string(),
    })
    .array()
    .optional()
    .catch(undefined),
  'us.cloke.msc4175.tz': z
    .string()
    .transform((s) => s.replace(/^["']|["']$/g, ''))
    .optional()
    .catch(undefined),
});

export type ExtendedProfile = z.infer<typeof extendedProfile>;

export function useExtendedProfileSupported(): boolean {
  const { versions, unstable_features: unstableFeatures } = useSpecVersions();

  return unstableFeatures?.['uk.tcpip.msc4133'] || versions.includes('v1.15');
}

/// Whether to use the v1.15 stable endpoint at /_matrix/client/v3/profile/{userId}
/// instead of letting the SDK pick the unstable prefix. Some servers (e.g.
/// Continuwuity) support the stable spec but don't advertise the
/// `uk.tcpip.msc4133.stable` unstable-feature flag the SDK probes for, so the
/// SDK's own helpers 404 against /_matrix/client/unstable/uk.tcpip.msc4133/...
export function useExtendedProfileUsesStableEndpoint(): boolean {
  const { versions } = useSpecVersions();
  return versions.includes('v1.15');
}

const V3_PREFIX = '/_matrix/client/v3';
const profilePath = (userId: string) => `/profile/${encodeURIComponent(userId)}`;
const profileFieldPath = (userId: string, key: string) =>
  `${profilePath(userId)}/${encodeURIComponent(key)}`;

/// Direct HTTP wrappers that bypass the SDK's unstable-prefix logic. Used when
/// `useExtendedProfileUsesStableEndpoint()` is true.
export async function fetchExtendedProfileStable(
  mx: MatrixClient,
  userId: string
): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mx.http as any).authedRequest('GET', profilePath(userId), undefined, undefined, {
    prefix: V3_PREFIX,
  });
}

export async function setExtendedProfilePropertyStable(
  mx: MatrixClient,
  userId: string,
  key: string,
  value: unknown
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (mx.http as any).authedRequest(
    'PUT',
    profileFieldPath(userId, key),
    undefined,
    { [key]: value },
    { prefix: V3_PREFIX }
  );
}

export async function deleteExtendedProfilePropertyStable(
  mx: MatrixClient,
  userId: string,
  key: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (mx.http as any).authedRequest(
    'DELETE',
    profileFieldPath(userId, key),
    undefined,
    undefined,
    { prefix: V3_PREFIX }
  );
}

export type ExtendedProfileResult = {
  /// `undefined` while the request is in flight, `null` if the HS lacks support,
  /// otherwise the parsed extended profile (possibly empty `{}` after a fetch error).
  data: ExtendedProfile | undefined | null;
  /// The error message if the fetch or parse failed. The form still renders the
  /// MSC4133 fields with empty defaults so the user can attempt to overwrite,
  /// but this string is surfaced in the UI for debugging.
  error: string | null;
  refetch: () => Promise<void>;
};

/// Returns the user's MSC4133 extended profile, if our homeserver supports it.
export function useExtendedProfile(userId: string): ExtendedProfileResult {
  const mx = useMatrixClient();
  const extendedProfileSupported = useExtendedProfileSupported();
  const useStable = useExtendedProfileUsesStableEndpoint();
  const { data, refetch } = useQuery({
    queryKey: ['extended-profile', userId, useStable],
    queryFn: useCallback(async (): Promise<{
      profile: ExtendedProfile | null;
      error: string | null;
    }> => {
      if (!extendedProfileSupported) return { profile: null, error: null };
      try {
        const raw = useStable
          ? await fetchExtendedProfileStable(mx, userId)
          : await mx.getExtendedProfile(userId);
        return {
          profile: extendedProfile.parse(raw),
          error: null,
        };
      } catch (err) {
        // Server claims MSC4133 support (via unstable_features or v1.15) but
        // the request or parse failed. Surface the error in the UI rather than
        // silently hiding the fields, and keep the form usable with empty
        // defaults so the user can still attempt to write values back.
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[extended-profile] fetch failed:', err);
        return { profile: {} as ExtendedProfile, error: message };
      }
    }, [mx, userId, extendedProfileSupported, useStable]),
    refetchOnMount: false,
  });

  return {
    data: data?.profile,
    error: data?.error ?? null,
    refetch: async () => {
      await refetch();
    },
  };
}

const LEGACY_FIELDS = ['displayname', 'avatar_url'];

/// Returns whether the given profile field may be edited by the user.
export function profileEditsAllowed(
  field: string,
  capabilities: Capabilities,
  extendedProfileSupported: boolean
): boolean {
  if (LEGACY_FIELDS.includes(field)) {
    // this field might have a pre-msc4133 capability. check that first
    if (capabilities[`m.set_${field}`]?.enabled === false) {
      return false;
    }

    if (!extendedProfileSupported) {
      // the homeserver only supports legacy fields
      return true;
    }
  }

  if (extendedProfileSupported) {
    // the homeserver has msc4133 support
    const extendedProfileCapability = capabilities[
      'uk.tcpip.msc4133.profile_fields'
    ] as IProfileFieldsCapability;

    if (extendedProfileCapability === undefined) {
      // the capability is missing, assume modification is allowed
      return true;
    }

    if (!extendedProfileCapability.enabled) {
      // the capability is set to disable profile modifications
      return false;
    }

    if (
      extendedProfileCapability.allowed !== undefined &&
      !extendedProfileCapability.allowed.includes(field)
    ) {
      // the capability includes an allowlist and `field` isn't in it
      return false;
    }

    if (extendedProfileCapability.disallowed?.includes(field)) {
      // the capability includes an blocklist and `field` is in it
      return false;
    }

    // the capability is enabled and `field` isn't blocked
    return true;
  }

  // `field` is an extended profile key and the homeserver lacks msc4133 support
  return false;
}
