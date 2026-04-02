import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/files': 'http://localhost:4000'
    }
  },
  // Cornerstone dicom-image-loader usa web workers
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader']
  }
});
