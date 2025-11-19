// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // IMPORTANT for GitHub Pages: replace with your repo name
  base: '/continuous-vlm-assisted-privacy-awareness/',
});
