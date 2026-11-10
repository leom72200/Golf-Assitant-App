import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with values that must not be committed.
 * Android maps need a Google Maps SDK key: set GOOGLE_MAPS_API_KEY in your shell or an EAS secret.
 * iOS uses Apple Maps and needs no key.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: (config.plugins ?? []).map((plugin) =>
    plugin === 'react-native-maps'
      ? ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY }]
      : plugin,
  ),
});
