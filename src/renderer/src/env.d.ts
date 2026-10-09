import type { EdssiApi } from '../../shared/api';

declare global {
  interface Window {
    edssi: EdssiApi;
  }
}
