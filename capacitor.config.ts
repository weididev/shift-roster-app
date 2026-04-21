import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shiftpro.app',
  appName: 'ShiftPro',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
