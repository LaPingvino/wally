import { AutoDiscoveryInfo } from '../cs-api';
import { useAutoDiscoveryInfo } from './useAutoDiscoveryInfo';
import { callDebug } from '../features/call/callDebug';

export const livekitSupport = (autoDiscoveryInfo: AutoDiscoveryInfo): boolean => {
  const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'];

  const supported = Array.isArray(rtcFoci) && rtcFoci.some((info) => typeof info.livekit_service_url === 'string');
  callDebug('focus', 'livekitSupport check', { rtcFoci, supported });
  return supported;
};

export const useLivekitSupport = (): boolean => {
  const autoDiscoveryInfo = useAutoDiscoveryInfo();

  return livekitSupport(autoDiscoveryInfo);
};
