import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.gbraad.meister',
  appName: 'Regroove Meister',
  webDir: '.',  // Use root directory (index.html is here)
  server: {
    androidScheme: 'https',
    // Enable cleartext traffic for local MIDI devices
    cleartext: true
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK'
    }
  },
  plugins: {
    // Web MIDI API support (requires USB OTG or Bluetooth MIDI)
    // Note: Web MIDI API is available in Chrome on Android
  }
};

export default config;
